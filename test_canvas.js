const http = require('http');
http.get('http://127.0.0.1:8000/', (res) => {
    let data = '';
    res.on('data', (chunk) => data += chunk);
    res.on('end', () => console.log('Response code:', res.statusCode));
});
