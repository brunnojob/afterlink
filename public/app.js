import { random, session } from './crypto.js';
const $ = id => document.getElementById(id);
let invitation, socket, cipher, ownName = '', peerName = '', inviteUrl = '', paired = false, finished = false, connectTimer;
let sendQueue = Promise.resolve(), receiveQueue = Promise.resolve();
function notice(text) { $('notice').textContent = text; $('notice').hidden = !text; }
function finish(reason) {
  if (finished) return;
  finished = true;
  clearTimeout(connectTimer);
  paired = false; cipher = null; invitation = null; inviteUrl = ''; ownName = ''; peerName = '';
  $('messages').replaceChildren();
  for (const id of ['message', 'name', 'invite']) $(id).value = '';
  $('welcome').hidden = true; $('room').hidden = true; $('ended').hidden = false;
  $('end-reason').textContent = reason;
  notice(''); socket?.close();
}
function bubble(name, text, mine) {
  if ($('empty')) $('empty').hidden = true;
  const block = document.createElement('article');
  block.className = `bubble${mine ? ' mine' : ''}`;
  const author = document.createElement('strong'); author.textContent = mine ? `${name} · você` : name;
  const body = document.createElement('p'); body.textContent = text;
  const time = document.createElement('time');
  time.textContent = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date());
  block.append(author, body, time); $('messages').append(block);
  while ($('messages').children.length > 200) $('messages').firstElementChild.remove();
  $('messages').scrollTop = $('messages').scrollHeight;
}
function transmit(payload) {
  sendQueue = sendQueue.then(async () => {
    if (finished || !cipher || socket?.readyState !== WebSocket.OPEN) throw new Error('Disconnected');
    const packet = await cipher.seal(payload);
    if (finished || socket.readyState !== WebSocket.OPEN) throw new Error('Disconnected');
    socket.send(JSON.stringify(packet));
  });
  return sendQueue;
}
async function handle(data) {
  if (finished) return;
  if (data.type === 'created') {
    if (!/^[A-Za-z0-9_-]{32}$/.test(data.room)) throw new Error('Invalid room');
    const secret = random(32); cipher = await session(secret, data.room);
    if (finished) { cipher = null; return; }
    inviteUrl = `${location.origin}/#${data.room}.${secret}`; $('invite').value = inviteUrl;
    $('status').textContent = 'Aguardando a outra pessoa entrar.'; $('copy').disabled = false;
  } else if (data.type === 'paired') {
    if (!cipher) throw new Error('Missing key');
    $('status').textContent = 'Verificando conexão criptografada…';
    $('invite-panel').hidden = true; inviteUrl = ''; $('invite').value = '';
    await transmit({ kind: 'hello', name: ownName });
  } else if (data.type === 'packet') {
    if (!cipher) throw new Error('Missing key');
    const payload = await cipher.open(data);
    if (finished) return;
    if (!paired && payload.kind === 'hello' && typeof payload.name === 'string' && payload.name.trim().length > 0 && payload.name.length <= 32) {
      paired = true; peerName = payload.name;
      $('room-title').textContent = `Você e ${peerName}`;
      $('status').textContent = 'Conectados · criptografia de ponta a ponta ativa';
      $('message').disabled = false; $('send').disabled = false; $('message').placeholder = 'Escreva algo…';
      $('empty').querySelector('h3').textContent = 'Agora é com vocês.';
      $('empty').querySelector('p').textContent = 'Nenhuma mensagem será guardada pelo aplicativo.';
      $('message').focus();
    } else if (paired && payload.kind === 'message' && typeof payload.text === 'string' && payload.text.trim().length && payload.text.length <= 4000) bubble(peerName, payload.text, false);
    else throw new Error('Invalid message');
  } else if (data.type === 'unavailable') finish('Este convite expirou, já foi usado ou a sala está completa. Crie uma nova conversa.');
  else if (data.type === 'ended') finish('A sessão terminou. O histórico foi removido desta página. Salas duram no máximo uma hora.');
  else throw new Error('Invalid event');
}
try {
  const fragment = location.hash.slice(1); history.replaceState(null, '', location.pathname);
  if (fragment) {
    const match = /^([A-Za-z0-9_-]{32})\.([A-Za-z0-9_-]{43})$/.exec(fragment);
    if (!match) throw new Error('Convite inválido. Peça um novo link completo.');
    invitation = { room: match[1], secret: match[2] };
    $('entry-title').textContent = 'Você recebeu um convite.';
    $('entry-description').textContent = 'Escolha como quer ser chamado e entre na conversa.';
    $('enter').textContent = 'Entrar na conversa ↗';
  }
  if (!window.isSecureContext || !crypto.subtle) throw new Error('Abra o site por HTTPS para usar a criptografia. Para desenvolvimento, use localhost.');
} catch (error) { notice(error.message); $('enter').disabled = true; }
$('entry').addEventListener('submit', async event => {
  event.preventDefault(); ownName = $('name').value.trim();
  if (!ownName || ownName.length > 32) return;
  $('enter').disabled = true;
  try {
    if (invitation) cipher = await session(invitation.secret, invitation.room);
    $('welcome').hidden = true; $('room').hidden = false; $('invite-panel').hidden = Boolean(invitation); $('copy').disabled = true;
    socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/socket`);
    connectTimer = setTimeout(() => finish('Não foi possível conectar. Tente criar outra conversa.'), 15000);
    socket.addEventListener('open', () => {
      clearTimeout(connectTimer);
      socket.send(JSON.stringify(invitation ? { type: 'join', room: invitation.room } : { type: 'create' })); invitation = null;
    });
    socket.addEventListener('message', event => {
      receiveQueue = receiveQueue.then(() => handle(JSON.parse(event.data))).catch(() => finish('Não foi possível verificar a conversa. Por segurança, esta sessão foi encerrada.'));
    });
    socket.addEventListener('close', () => finish('A conexão foi encerrada. O histórico foi removido desta página.'));
    socket.addEventListener('error', () => finish('Não foi possível conectar ao chat. Verifique sua conexão e tente novamente.'));
  } catch { finish('Não foi possível iniciar a conversa criptografada. Crie outro convite.'); }
});
$('copy').addEventListener('click', async () => {
  if (!inviteUrl) return;
  try { await navigator.clipboard.writeText(inviteUrl); $('copy').textContent = 'Link copiado'; }
  catch { $('invite').focus(); $('invite').select(); notice('Copie o link selecionado e envie para a outra pessoa.'); }
});
$('compose').addEventListener('submit', async event => {
  event.preventDefault(); const text = $('message').value.trim();
  if (!paired || !text || text.length > 4000) return;
  $('send').disabled = true; $('message').value = '';
  try { await transmit({ kind: 'message', text }); if (!finished) bubble(ownName, text, true); }
  catch { finish('A mensagem não pôde ser enviada. A sessão foi encerrada.'); }
  if (!finished) { $('send').disabled = false; $('message').focus(); }
});
$('message').addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); if (!$('send').disabled) $('compose').requestSubmit(); }
});
$('leave').addEventListener('click', () => finish('Você encerrou a conversa. O histórico foi removido desta página.'));
window.addEventListener('pagehide', () => finish('A sessão foi encerrada.'));
