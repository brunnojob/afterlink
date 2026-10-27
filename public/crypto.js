const encoder = new TextEncoder();
const decoder = new TextDecoder();
export const encode = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
export const decode = text => Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
export const random = size => encode(crypto.getRandomValues(new Uint8Array(size)));

export async function session(secret, room) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(secret) || decode(secret).length !== 32) throw new Error('Invalid key');
  const master = await crypto.subtle.importKey('raw', decode(secret), 'HKDF', false, ['deriveKey']);
  const sender = random(16);
  let sequence = 0;
  let remoteSender;
  let received = 0;
  const keyFor = id => crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: encoder.encode(room), info: encoder.encode(`afterlink-v1:${id}`) }, master, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const sendingKey = await keyFor(sender);
  let receivingKey;
  return {
    async seal(payload) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const body = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(room) }, sendingKey, encoder.encode(JSON.stringify({ ...payload, sequence: ++sequence })));
      return { type: 'packet', sender, iv: encode(iv), body: encode(body) };
    },
    async open(packet) {
      if (!packet || !/^[A-Za-z0-9_-]{22}$/.test(packet.sender) || !/^[A-Za-z0-9_-]{16}$/.test(packet.iv) || typeof packet.body !== 'string' || packet.body.length > 24000) throw new Error('Invalid packet');
      if (packet.sender === sender || (remoteSender && remoteSender !== packet.sender)) throw new Error('Sender changed');
      const key = receivingKey || await keyFor(packet.sender);
      const raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(packet.iv), additionalData: encoder.encode(room) }, key, decode(packet.body));
      const payload = JSON.parse(decoder.decode(raw));
      if (!Number.isSafeInteger(payload.sequence) || payload.sequence !== received + 1) throw new Error('Invalid sequence');
      remoteSender = packet.sender;
      receivingKey = key;
      received = payload.sequence;
      return payload;
    }
  };
}
