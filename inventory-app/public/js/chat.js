(function () {
  var messagesEl = document.getElementById('chat-messages');
  if (messagesEl) {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  var textarea = document.getElementById('chat-text');
  if (textarea) {
    textarea.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        document.getElementById('chat-form').submit();
      }
    });
  }

  window.sendQuick = function (text) {
    var input = document.getElementById('chat-text');
    input.value = text;
    document.getElementById('chat-form').submit();
  };
})();
