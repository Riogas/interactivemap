import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { marked } from 'marked';

export async function GET() {
  try {
    // Leer el archivo de documentación
    const docPath = path.join(process.cwd(), 'API_DOCUMENTATION.md');
    const markdown = fs.readFileSync(docPath, 'utf-8');

    // Convertir Markdown a HTML
    const htmlContent = await marked(markdown);

    // HTML con estilos tipo GitHub/Redoc
    const html = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TrackMovil API Documentation</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif;
      line-height: 1.6;
      color: #24292e;
      background: #f6f8fa;
      padding: 20px;
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
      background: white;
      padding: 40px;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }

    h1 {
      color: #0366d6;
      border-bottom: 3px solid #0366d6;
      padding-bottom: 10px;
      margin-bottom: 30px;
      font-size: 2.5em;
    }

    h2 {
      color: #0366d6;
      margin-top: 40px;
      margin-bottom: 20px;
      padding-bottom: 8px;
      border-bottom: 2px solid #e1e4e8;
      font-size: 2em;
    }

    h3 {
      color: #24292e;
      margin-top: 30px;
      margin-bottom: 15px;
      font-size: 1.5em;
    }

    h4 {
      color: #586069;
      margin-top: 20px;
      margin-bottom: 10px;
      font-size: 1.2em;
    }

    p {
      margin-bottom: 16px;
    }

    code {
      background: #f6f8fa;
      padding: 3px 6px;
      border-radius: 3px;
      font-family: 'Courier New', Courier, monospace;
      font-size: 0.9em;
      color: #e83e8c;
    }

    pre {
      background: #f6f8fa;
      border: 1px solid #e1e4e8;
      border-radius: 6px;
      padding: 16px;
      overflow-x: auto;
      margin-bottom: 16px;
    }

    pre code {
      background: transparent;
      padding: 0;
      color: #24292e;
      font-size: 0.85em;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 20px;
      font-size: 0.9em;
    }

    th {
      background: #f6f8fa;
      border: 1px solid #e1e4e8;
      padding: 12px;
      text-align: left;
      font-weight: 600;
      color: #24292e;
    }

    td {
      border: 1px solid #e1e4e8;
      padding: 12px;
    }

    tr:hover {
      background: #f6f8fa;
    }

    a {
      color: #0366d6;
      text-decoration: none;
    }

    a:hover {
      text-decoration: underline;
    }

    ul, ol {
      margin-left: 20px;
      margin-bottom: 16px;
    }

    li {
      margin-bottom: 8px;
    }

    blockquote {
      border-left: 4px solid #dfe2e5;
      padding-left: 16px;
      color: #6a737d;
      margin-bottom: 16px;
    }

    hr {
      border: 0;
      border-top: 2px solid #e1e4e8;
      margin: 40px 0;
    }

    .badge {
      display: inline-block;
      padding: 3px 8px;
      border-radius: 3px;
      font-size: 0.85em;
      font-weight: 600;
    }

    .badge-post {
      background: #28a745;
      color: white;
    }

    .badge-put {
      background: #ffc107;
      color: black;
    }

    .badge-delete {
      background: #dc3545;
      color: white;
    }

    .badge-get {
      background: #17a2b8;
      color: white;
    }

    /* Syntax highlighting básico */
    .hljs-string { color: #032f62; }
    .hljs-number { color: #005cc5; }
    .hljs-keyword { color: #d73a49; }
    .hljs-comment { color: #6a737d; }

    /* Scroll suave */
    html {
      scroll-behavior: smooth;
    }

    /* Header fijo */
    .doc-header {
      position: sticky;
      top: 0;
      background: white;
      padding: 20px 0;
      border-bottom: 2px solid #e1e4e8;
      margin-bottom: 30px;
      z-index: 100;
    }

    .back-to-top {
      position: fixed;
      bottom: 30px;
      right: 30px;
      background: #0366d6;
      color: white;
      width: 50px;
      height: 50px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(0,0,0,0.2);
      transition: all 0.3s;
    }

    .back-to-top:hover {
      background: #0256c9;
      transform: translateY(-3px);
    }
  </style>
</head>
<body>
  <div class="container">
    ${htmlContent}
  </div>
  
  <div class="back-to-top" onclick="window.scrollTo({top: 0, behavior: 'smooth'})">
    ⬆️
  </div>

  <script>
    // Agregar badges a los métodos HTTP
    document.querySelectorAll('h2').forEach(h2 => {
      const text = h2.textContent;
      if (text.includes('POST')) {
        h2.innerHTML = '<span class="badge badge-post">POST</span> ' + text.replace('POST ', '');
      } else if (text.includes('PUT')) {
        h2.innerHTML = '<span class="badge badge-put">PUT</span> ' + text.replace('PUT ', '');
      } else if (text.includes('DELETE')) {
        h2.innerHTML = '<span class="badge badge-delete">DELETE</span> ' + text.replace('DELETE ', '');
      } else if (text.includes('GET')) {
        h2.innerHTML = '<span class="badge badge-get">GET</span> ' + text.replace('GET ', '');
      }
    });

    // Smooth scroll para links internos
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
      anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    });
  </script>
</body>
</html>
    `;

    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html',
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Error al cargar la documentación', details: error.message },
      { status: 500 }
    );
  }
}
