/* Static file server that mounts the project at /Lyra/ — the same subfolder
 * shape GitHub Pages uses for project sites. */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PREFIX = "/Lyra";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".mp3": "audio/mpeg",
  ".lrc": "text/plain; charset=utf-8",
};

function createServer() {
  return http.createServer((req, res) => {
    const urlPath = decodeURIComponent(String(req.url || "/").split("?")[0]);
    if (!urlPath.startsWith(PREFIX)) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("outside mount");
      return;
    }
    let rel = urlPath.slice(PREFIX.length);
    if (!rel || rel === "/") rel = "/index.html";
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT)) {
      res.writeHead(403);
      res.end("forbidden");
      return;
    }
    fs.readFile(file, (err, buf) => {
      if (err) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("not found");
        return;
      }
      res.writeHead(200, {
        "Content-Type": TYPES[path.extname(file)] || "application/octet-stream",
        "Cache-Control": "no-store",
      });
      res.end(buf);
    });
  });
}

module.exports = { createServer, PREFIX, ROOT };
