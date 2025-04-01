
export const SERVER_URL = location.hostname == 'localhost' ? 'http://localhost:5000': `https://${location.hostname}`;
export const SERVER_URL_WS = location.hostname == 'localhost' ? 'ws://localhost:5000': `wss://${location.hostname}`;
export const generateModelId = (symbol: string, sequenceLength: number, daysToPredict: number, epochs: number, batchSize: number) => {
  return `${symbol}_seq${sequenceLength}_pred${daysToPredict}_ep${epochs}_bs${batchSize}`;
};
