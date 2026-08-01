import http from 'node:http';
import fs from 'node:fs';
const dir = process.argv[2];
http
  .createServer((req, res) => {
    const path = dir + req.url;
    if (!fs.existsSync(path)) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'image/jpeg' });
    fs.createReadStream(path).pipe(res);
  })
  .listen(9333, () => console.log('serving', dir));
