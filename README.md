<div align="center">

# Afterlink

### A name. A link. A conversation that stays in the moment.

Ephemeral, end-to-end encrypted browser chat for two people.<br>
No accounts. No API keys. No message database.

[How it works](#how-it-works) · [Run locally](#run-locally) · [Privacy](#privacy-and-security) · [Português](#em-português)

</div>

---

## Less setup. More conversation.

Choose a nickname, create a room and share a private invitation. When the other person joins, the room locks. When either person leaves, the session ends for both and the application clears the visible conversation.

- Minimal dark interface for desktop and mobile.
- Exactly two participants per room; no public room directory.
- Names and messages encrypted in the browser with AES-256-GCM.
- One-time invitations; closed rooms cannot be reopened.
- No cookies, browser storage, analytics, external fonts or tracking scripts.
- No database, message history, offline delivery or reconnect replay.
- Automatic expiration after one hour, including waiting time.
- MIT licensed. One runtime dependency: `ws`.

## How it works

1. Enter any nickname and create a conversation.
2. Copy the invitation and share it privately with one person.
3. The recipient opens the link and enters a nickname.
4. Chat. Enter sends; Shift+Enter adds a new line.
5. Close the tab or select **Encerrar** to end the session for both.

The invite contains a random room identifier and a 256-bit secret in its URL fragment (`#`). The browser removes the fragment from the address bar on opening. The server receives the room identifier, but the application never sends it the encryption secret. Each browser derives a separate sender key using HKDF-SHA-256. Names and messages use authenticated AES-256-GCM encryption with random 96-bit nonces and ordered sequence numbers to reject replayed packets.

A Node.js WebSocket relay forwards ciphertext to the other participant. Socket references live in memory until the room ends. There is no message archive or write-to-disk path. Reloading ends the conversation instead of restoring it.

## Run locally

Requires Node.js 22 or newer.

```sh
git clone https://github.com/brunnojob/afterlink.git
cd afterlink
npm ci
npm start
```

Open **http://localhost:3000** in two browser windows. Create a room in one and paste the invitation into the other. No `.env`, account, API key or external service is required. `PORT` optionally changes the listening port.

A localhost invitation only works on that computer. For remote conversations, deploy to a public HTTPS host with WebSocket support. HTTP over a LAN IP does not provide the secure context required by Web Crypto.

```sh
npm run check
npm test
```

## Deploy

Run `npm ci --omit=dev` and `npm start` on a Node.js host supporting long-lived WebSocket connections. Health check: `/healthz`. Terminate HTTPS at the provider or reverse proxy, forward WebSocket upgrades and preserve the original `Host` header. Do not cache HTML, scripts or socket traffic. Use one instance: rooms live in that process's memory and a restart ends all sessions.

```sh
docker build -t afterlink .
docker run --rm -p 3000:3000 afterlink
```

GitHub Pages alone cannot run the relay. This repository contains the complete app and CI; it does not provision a public chat server.

## Privacy and security

**No history means no application-level persistence, not guaranteed erasure everywhere.** Names, keys and the most recent 200 displayed messages live in browser memory during the session. Ciphertext briefly exists in network buffers. The app clears its DOM and state on exit, but cannot guarantee forensic erasure from operating system memory, crash dumps or browser internals.

- Anyone with the complete invitation has the secret and can try to occupy the second seat. Share it privately. Nicknames are not verified identities.
- Shared-secret encryption has no forward secrecy. This project has not had an independent security audit.
- HTTPS and a trusted host are necessary. An operator serving modified JavaScript could capture secrets.
- The relay and hosting network can observe metadata such as IP addresses, timing, room identifiers and traffic size. This is not an anonymity network.
- Browsers, extensions, clipboard history, invitation-sharing services, screenshots and recipients may retain copies.
- There is no offline queue or delivery receipt. Sending means handed to the socket, not proven read.
- Payload limits, per-connection rate limits, same-origin upgrades, connection caps and heartbeat cleanup are included. Public deployments also need network-level abuse controls.
- Disable request/body logging and proxy caching; review your host's retention policy. The app does not log names, room identifiers, secrets or message contents.

Reference: [W3C Web Cryptography API](https://www.w3.org/TR/webcrypto-1/).

## Project layout

| Path | Purpose |
| --- | --- |
| `public/` | Browser interface and Web Crypto encryption |
| `server.js` | Static server and in-memory relay |
| `test/` | Cryptography and room lifecycle tests |
| `Dockerfile` | Container deployment |
| `.github/` | Node.js 22 and 24 CI |

## Em português

**Um nome, um link, uma conversa.** Escolha um apelido, crie uma sala e envie o convite. Sem login, sem chave de API, com tema escuro e criptografia de ponta a ponta. Quando alguém sai, a sessão termina para os dois e o aplicativo remove o histórico visível. Nada é gravado em banco de dados ou no armazenamento do navegador.

O link contém uma chave secreta gerada automaticamente: você não precisa criar ou informar tokens. A sala aceita duas pessoas, bloqueia novas entradas após a conexão de ambas e expira em uma hora. Para conversar entre dispositivos, hospede o servidor em HTTPS. A interface está em português.

## License and authorship

[MIT](LICENSE). Created by [brunnodev.store](https://brunnodev.store).
