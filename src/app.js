const path = require('path');
const express = require('express');
const multer = require('multer');
const db = require('./db');
const { parseAttendanceCsv, decodeCsvBuffer, parseDateFromFilename } = require('./csv');

const MAX_IMPORT_FILES = 3;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));

function getCommitteeOr404(req, res) {
  const committee = db
    .prepare('SELECT * FROM committees WHERE id = ?')
    .get(req.params.id);
  if (!committee) {
    res.status(404).send('委員会が見つかりません');
    return null;
  }
  return committee;
}

// ---- 委員会一覧 / 追加 ----
app.get('/', (req, res) => {
  const committees = db
    .prepare(
      `SELECT c.*,
              (SELECT COUNT(*) FROM members m WHERE m.committee_id = c.id) AS member_count,
              (SELECT COUNT(*) FROM meetings mt WHERE mt.committee_id = c.id) AS meeting_count
       FROM committees c
       ORDER BY c.id`
    )
    .all();
  res.render('index', { committees });
});

app.post('/committees', (req, res) => {
  const name = (req.body.name || '').trim();
  if (name) {
    try {
      db.prepare('INSERT INTO committees (name) VALUES (?)').run(name);
    } catch (e) {
      // 名前重複などは無視してそのまま一覧へ戻る
    }
  }
  res.redirect('/');
});

app.post('/committees/:id/delete', (req, res) => {
  db.prepare('DELETE FROM committees WHERE id = ?').run(req.params.id);
  res.redirect('/');
});

// ---- 委員会詳細（委員・開催日の管理） ----
app.get('/committees/:id', (req, res) => {
  const committee = getCommitteeOr404(req, res);
  if (!committee) return;

  const members = db
    .prepare('SELECT * FROM members WHERE committee_id = ? ORDER BY id')
    .all(committee.id);
  const meetings = db
    .prepare(
      'SELECT *, (SELECT COUNT(*) FROM attendance a WHERE a.meeting_id = meetings.id AND a.present = 1) AS present_count FROM meetings WHERE committee_id = ? ORDER BY meeting_date DESC, id DESC'
    )
    .all(committee.id);

  const importError = req.query.import_error || null;
  let importSummary = null;
  if (req.query.import_summary) {
    try {
      importSummary = JSON.parse(req.query.import_summary);
    } catch {
      importSummary = null;
    }
  }

  res.render('committee', { committee, members, meetings, importError, importSummary });
});

app.post('/committees/:id/members', (req, res) => {
  const committee = getCommitteeOr404(req, res);
  if (!committee) return;
  const name = (req.body.name || '').trim();
  const role = (req.body.role || '').trim();
  const company = (req.body.company || '').trim();
  if (name) {
    db.prepare(
      'INSERT INTO members (committee_id, name, role, company) VALUES (?, ?, ?, ?)'
    ).run(committee.id, name, role || null, company || null);
  }
  res.redirect(`/committees/${committee.id}`);
});

app.get('/committees/:id/members/:memberId/edit', (req, res) => {
  const committee = getCommitteeOr404(req, res);
  if (!committee) return;
  const member = db
    .prepare('SELECT * FROM members WHERE id = ? AND committee_id = ?')
    .get(req.params.memberId, committee.id);
  if (!member) return res.status(404).send('委員が見つかりません');
  res.render('member_edit', { committee, member });
});

app.post('/committees/:id/members/:memberId/edit', (req, res) => {
  const committee = getCommitteeOr404(req, res);
  if (!committee) return;
  const name = (req.body.name || '').trim();
  const role = (req.body.role || '').trim();
  const company = (req.body.company || '').trim();
  if (name) {
    db.prepare(
      'UPDATE members SET name = ?, role = ?, company = ? WHERE id = ? AND committee_id = ?'
    ).run(name, role || null, company || null, req.params.memberId, committee.id);
  }
  res.redirect(`/committees/${committee.id}`);
});

app.post('/committees/:id/members/:memberId/delete', (req, res) => {
  const committee = getCommitteeOr404(req, res);
  if (!committee) return;
  db.prepare('DELETE FROM members WHERE id = ? AND committee_id = ?').run(
    req.params.memberId,
    committee.id
  );
  res.redirect(`/committees/${committee.id}`);
});

app.post('/committees/:id/meetings', (req, res) => {
  const committee = getCommitteeOr404(req, res);
  if (!committee) return;
  const meetingDate = (req.body.meeting_date || '').trim();
  const title = (req.body.title || '').trim();
  if (meetingDate) {
    const result = db
      .prepare(
        'INSERT INTO meetings (committee_id, meeting_date, title) VALUES (?, ?, ?)'
      )
      .run(committee.id, meetingDate, title || null);
    // 開催日追加時点の委員全員分、初期値「未記録(0)」の出欠行を用意しておく
    const members = db
      .prepare('SELECT id FROM members WHERE committee_id = ?')
      .all(committee.id);
    const insertAttendance = db.prepare(
      'INSERT INTO attendance (meeting_id, member_id, present) VALUES (?, ?, 0)'
    );
    for (const m of members) {
      insertAttendance.run(result.lastInsertRowid, m.id);
    }
  }
  res.redirect(`/committees/${committee.id}`);
});

app.post('/committees/:id/meetings/:meetingId/delete', (req, res) => {
  const committee = getCommitteeOr404(req, res);
  if (!committee) return;
  db.prepare('DELETE FROM meetings WHERE id = ? AND committee_id = ?').run(
    req.params.meetingId,
    committee.id
  );
  res.redirect(`/committees/${committee.id}`);
});

// ---- 出欠CSVインポート（最大3ファイル同時取り込み） ----
app.post('/committees/:id/import', upload.array('csv', MAX_IMPORT_FILES), (req, res) => {
  const committee = getCommitteeOr404(req, res);
  if (!committee) return;

  // multer/busboyはmultipartのファイル名ヘッダーをlatin1として解釈するため、
  // 日本語ファイル名が文字化けする。UTF-8として読み直す。
  const files = (req.files || []).map((f) => ({
    ...f,
    originalname: Buffer.from(f.originalname, 'latin1').toString('utf8'),
  }));
  const fallbackDate = (req.body.meeting_date || '').trim();
  const meetingTitle = (req.body.title || '').trim();
  const currentYear = new Date().getFullYear();

  if (files.length === 0) {
    return res.redirect(
      `/committees/${committee.id}?import_error=${encodeURIComponent('CSVファイルを選択してください（最大3ファイル）')}`
    );
  }

  const findMember = db.prepare(
    'SELECT * FROM members WHERE committee_id = ? AND name = ?'
  );
  const insertMember = db.prepare(
    'INSERT INTO members (committee_id, name, role, company) VALUES (?, ?, ?, ?)'
  );
  const findMeeting = db.prepare(
    'SELECT * FROM meetings WHERE committee_id = ? AND meeting_date = ?'
  );
  const insertMeeting = db.prepare(
    'INSERT INTO meetings (committee_id, meeting_date, title) VALUES (?, ?, ?)'
  );
  const upsertAttendance = db.prepare(
    `INSERT INTO attendance (meeting_id, member_id, present) VALUES (?, ?, ?)
     ON CONFLICT(meeting_id, member_id) DO UPDATE SET present = excluded.present`
  );

  const results = [];
  const tx = db.transaction(() => {
    for (const file of files) {
      const detectedDate = parseDateFromFilename(file.originalname, currentYear);
      const meetingDate = detectedDate || fallbackDate;

      if (!meetingDate) {
        results.push({
          filename: file.originalname,
          error: 'ファイル名から開催日を判定できず、開催日欄も未入力のため取り込めませんでした',
        });
        continue;
      }

      let records;
      try {
        const text = decodeCsvBuffer(file.buffer);
        records = parseAttendanceCsv(text);
      } catch (e) {
        results.push({ filename: file.originalname, error: e.message });
        continue;
      }

      let meeting = findMeeting.get(committee.id, meetingDate);
      if (!meeting) {
        const result = insertMeeting.run(committee.id, meetingDate, meetingTitle || null);
        meeting = { id: result.lastInsertRowid };
      }

      let createdMembers = 0;
      let presentCount = 0;
      for (const rec of records) {
        let member = findMember.get(committee.id, rec.name);
        if (!member) {
          const result = insertMember.run(
            committee.id,
            rec.name,
            rec.role || null,
            rec.company || null
          );
          member = { id: result.lastInsertRowid };
          createdMembers++;
        }
        upsertAttendance.run(meeting.id, member.id, rec.present ? 1 : 0);
        if (rec.present) presentCount++;
      }

      results.push({
        filename: file.originalname,
        meetingDate,
        dateSource: detectedDate ? 'filename' : 'form',
        total: records.length,
        present: presentCount,
        created: createdMembers,
      });
    }
  });
  tx();

  const qs = new URLSearchParams({ import_summary: JSON.stringify(results) });
  res.redirect(`/committees/${committee.id}?${qs.toString()}`);
});

// ---- 出欠記録 ----
app.get('/committees/:id/meetings/:meetingId', (req, res) => {
  const committee = getCommitteeOr404(req, res);
  if (!committee) return;
  const meeting = db
    .prepare('SELECT * FROM meetings WHERE id = ? AND committee_id = ?')
    .get(req.params.meetingId, committee.id);
  if (!meeting) return res.status(404).send('開催日が見つかりません');

  const members = db
    .prepare(
      `SELECT mem.id, mem.name, COALESCE(a.present, 0) AS present
       FROM members mem
       LEFT JOIN attendance a ON a.member_id = mem.id AND a.meeting_id = ?
       WHERE mem.committee_id = ?
       ORDER BY mem.id`
    )
    .all(meeting.id, committee.id);

  res.render('meeting', { committee, meeting, members });
});

app.post('/committees/:id/meetings/:meetingId', (req, res) => {
  const committee = getCommitteeOr404(req, res);
  if (!committee) return;
  const meeting = db
    .prepare('SELECT * FROM meetings WHERE id = ? AND committee_id = ?')
    .get(req.params.meetingId, committee.id);
  if (!meeting) return res.status(404).send('開催日が見つかりません');

  const members = db
    .prepare('SELECT id FROM members WHERE committee_id = ?')
    .all(committee.id);
  const presentIds = new Set(
    []
      .concat(req.body.present || [])
      .map((v) => Number(v))
  );

  const upsert = db.prepare(
    `INSERT INTO attendance (meeting_id, member_id, present) VALUES (?, ?, ?)
     ON CONFLICT(meeting_id, member_id) DO UPDATE SET present = excluded.present`
  );
  const tx = db.transaction(() => {
    for (const m of members) {
      upsert.run(meeting.id, m.id, presentIds.has(m.id) ? 1 : 0);
    }
  });
  tx();

  res.redirect(`/committees/${committee.id}`);
});

// ---- 月別出席集計 ----
app.get('/committees/:id/report', (req, res) => {
  const committee = getCommitteeOr404(req, res);
  if (!committee) return;

  const now = new Date();
  const year = parseInt(req.query.year, 10) || now.getFullYear();
  const month = parseInt(req.query.month, 10) || now.getMonth() + 1;
  const monthStr = String(month).padStart(2, '0');
  const prefix = `${year}-${monthStr}`;

  const meetings = db
    .prepare(
      `SELECT * FROM meetings
       WHERE committee_id = ? AND meeting_date LIKE ?
       ORDER BY meeting_date`
    )
    .all(committee.id, `${prefix}%`);

  const members = db
    .prepare('SELECT * FROM members WHERE committee_id = ? ORDER BY id')
    .all(committee.id);

  const meetingIds = meetings.map((m) => m.id);
  const rows = members.map((member) => {
    let presentCount = 0;
    if (meetingIds.length > 0) {
      const placeholders = meetingIds.map(() => '?').join(',');
      const result = db
        .prepare(
          `SELECT COUNT(*) AS cnt FROM attendance
           WHERE member_id = ? AND present = 1 AND meeting_id IN (${placeholders})`
        )
        .get(member.id, ...meetingIds);
      presentCount = result.cnt;
    }
    const total = meetings.length;
    const rate = total > 0 ? Math.round((presentCount / total) * 1000) / 10 : null;
    return { member, presentCount, total, rate };
  });

  res.render('report', {
    committee,
    year,
    month,
    meetings,
    rows,
  });
});

// ---- 全体集計（委員×開催回のマトリクス + 個人別出席グラフ） ----
app.get('/committees/:id/matrix', (req, res) => {
  const committee = getCommitteeOr404(req, res);
  if (!committee) return;

  const members = db
    .prepare('SELECT * FROM members WHERE committee_id = ? ORDER BY id')
    .all(committee.id);
  const meetings = db
    .prepare('SELECT * FROM meetings WHERE committee_id = ? ORDER BY meeting_date, id')
    .all(committee.id);

  const attendanceRows = db
    .prepare(
      `SELECT a.meeting_id, a.member_id, a.present
       FROM attendance a
       JOIN meetings m ON m.id = a.meeting_id
       WHERE m.committee_id = ?`
    )
    .all(committee.id);
  const presentSet = new Set(
    attendanceRows.filter((r) => r.present).map((r) => `${r.meeting_id}:${r.member_id}`)
  );

  const totalMeetings = meetings.length;
  const memberRows = members.map((member) => {
    const cells = meetings.map((mt) => presentSet.has(`${mt.id}:${member.id}`));
    const presentCount = cells.filter(Boolean).length;
    const rate = totalMeetings > 0 ? Math.round((presentCount / totalMeetings) * 1000) / 10 : null;
    return { member, cells, presentCount, rate };
  });

  const meetingTotals = meetings.map(
    (mt) => memberRows.filter((r) => presentSet.has(`${mt.id}:${r.member.id}`)).length
  );

  const maxPresent = memberRows.reduce((max, r) => Math.max(max, r.presentCount), 0);

  res.render('matrix', {
    committee,
    meetings,
    memberRows,
    meetingTotals,
    totalMeetings,
    maxPresent,
  });
});

// ---- 全委員会 出席ランキング ----
app.get('/ranking', (req, res) => {
  const order = req.query.order === 'asc' ? 'asc' : 'desc';

  const rows = db
    .prepare(
      `SELECT m.id AS member_id, m.name, m.company, c.name AS committee_name,
              (SELECT COUNT(*) FROM attendance a WHERE a.member_id = m.id AND a.present = 1) AS present_count
       FROM members m
       JOIN committees c ON c.id = m.committee_id
       ORDER BY present_count ${order === 'asc' ? 'ASC' : 'DESC'}, m.id ASC`
    )
    .all();

  res.render('ranking', { rows, order });
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const message =
      err.code === 'LIMIT_UNEXPECTED_FILE'
        ? `CSVファイルは最大${MAX_IMPORT_FILES}件まで同時に選択できます`
        : err.message;
    const match = req.originalUrl.match(/^\/committees\/(\d+)\/import/);
    const committeeId = match ? match[1] : null;
    if (committeeId) {
      return res.redirect(
        `/committees/${committeeId}?import_error=${encodeURIComponent(message)}`
      );
    }
    return res.status(400).send(`アップロードエラー: ${message}`);
  }
  next(err);
});

app.listen(PORT, () => {
  console.log(`委員会出席カウントシステム起動: http://localhost:${PORT}`);
});
