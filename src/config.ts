export const SERVER_URL = location.hostname == 'localhost' ? 'http://localhost:5000': `https://${location.hostname}`;
export const SERVER_URL_WS = location.hostname == 'localhost' ? 'ws://localhost:5000': `wss://${location.hostname}`;
