export const SERVER_URL = location.host == 'localhost' ? 'http://localhost:5000': 'https://stock-trends.netlify.app';
export const SERVER_URL_WS = location.host == 'localhost' ? 'ws://localhost:5000': 'ws://stock-trends.netlify.app';
// {
//     localhost: 'http://localhost:5000',
//     localhostws: '',
//     remote: 'https://stock-trends.netlify.app',
//     remotews: ''
// }