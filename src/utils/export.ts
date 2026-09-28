import { MindMap, MindMapNode } from '../types';
import { generateNodeId } from './tree';
import JSZip from 'jszip';

/**
 * Exports mindmap to standard Markdown format:
 * # Root
 * - Child
 *   - Subchild
 */
export function exportToMarkdown(map: MindMap): string {
  const lines: string[] = [];
  lines.push(`# ${map.title || map.root.text || 'Mapa'}\n`);

  function traverse(node: MindMapNode, depth: number) {
    for (const child of node.children || []) {
      const indent = '  '.repeat(depth);
      lines.push(`${indent}- ${child.text}`);
      traverse(child, depth + 1);
    }
  }

  traverse(map.root, 0);
  return lines.join('\n');
}

/**
 * Exports mindmap to OPML 2.0 format
 */
export function exportToOPML(map: MindMap): string {
  function escapeXml(unsafe: string) {
    return unsafe.replace(/[<>&'"]/g, (c) => {
      switch (c) {
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '&': return '&amp;';
        case '\'': return '&apos;';
        case '"': return '&quot;';
        default: return c;
      }
    });
  }

  function nodeToXml(node: MindMapNode, depth: number): string {
    const indent = '  '.repeat(depth);
    const escapedText = escapeXml(node.text);
    if (!node.children || node.children.length === 0) {
      return `${indent}<outline text="${escapedText}" />`;
    }
    const childrenXml = node.children.map((c) => nodeToXml(c, depth + 1)).join('\n');
    return `${indent}<outline text="${escapedText}">\n${childrenXml}\n${indent}</outline>`;
  }

  const rootChildrenXml = (map.root.children || []).map((c) => nodeToXml(c, 2)).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>${escapeXml(map.title)}</title>
    <dateCreated>${map.createdAt}</dateCreated>
    <dateModified>${map.updatedAt}</dateModified>
  </head>
  <body>
    <outline text="${escapeXml(map.root.text)}">
${rootChildrenXml}
    </outline>
  </body>
</opml>`;
}

/**
 * Exports mindmap to FreeMind (.mm) format
 */
export function exportToFreeMind(map: MindMap): string {
  function escapeXml(unsafe: string) {
    return unsafe.replace(/[<>&'"]/g, (c) => {
      switch (c) {
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '&': return '&amp;';
        case '\'': return '&apos;';
        case '"': return '&quot;';
        default: return c;
      }
    });
  }

  function nodeToXml(node: MindMapNode, position?: 'left' | 'right'): string {
    const posAttr = position ? ` POSITION="${position}"` : '';
    const escaped = escapeXml(node.text);
    if (!node.children || node.children.length === 0) {
      return `<node ID="${node.id}" TEXT="${escaped}"${posAttr} />`;
    }
    const childrenXml = node.children.map((c, i) => {
      // Alternate left and right for top-level children
      const nextPos = position ? position : (i % 2 === 0 ? 'right' : 'left');
      return nodeToXml(c, nextPos);
    }).join('\n');
    return `<node ID="${node.id}" TEXT="${escaped}"${posAttr}>\n${childrenXml}\n</node>`;
  }

  const childrenXml = (map.root.children || []).map((c, i) => {
    const pos = i % 2 === 0 ? 'right' : 'left';
    return nodeToXml(c, pos);
  }).join('\n');

  return `<map version="1.0.1">
  <node ID="${map.root.id}" TEXT="${escapeXml(map.root.text)}">
${childrenXml}
  </node>
</map>`;
}

/**
 * Downloads a string content as file
 */
export function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  downloadBlob(blob, filename);
}

/**
 * Downloads a Blob directly
 */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Export a single session in Markdown (.md)
 */
export function exportSessionMarkdown(session: MindMap) {
  const md = exportToMarkdown(session);
  const clientName = session.clientName ? sanitizeFilename(session.clientName) : 'Cliente';
  const sessionName = sanitizeFilename(session.sessionDate || session.title || 'sessao');
  downloadFile(md, `${clientName}_${sessionName}.md`, 'text/markdown;charset=utf-8');
}

/**
 * Export all sessions of a specific client in Markdown, zipped by client name
 */
export async function exportClientSessionsZip(clientName: string, sessions: MindMap[]): Promise<void> {
  const zip = new JSZip();
  const safeClientName = sanitizeFilename(clientName || 'Cliente');

  if (sessions.length === 0) {
    zip.file('README.txt', `Nenhuma sessão registrada para o cliente ${clientName}.`);
  } else {
    const usedNames = new Set<string>();
    sessions.forEach((s, idx) => {
      const md = exportToMarkdown(s);
      let sessionName = sanitizeFilename(s.sessionDate || s.title || `sessao_${idx + 1}`);
      if (usedNames.has(sessionName)) {
        sessionName = `${sessionName}_${idx + 1}`;
      }
      usedNames.add(sessionName);
      zip.file(`${sessionName}.md`, md);
    });
  }

  const blob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  downloadBlob(blob, `${safeClientName}_sessoes.zip`);
}

/**
 * Export all sessions of all clients in Markdown, zipped with client folders
 */
export async function exportAllClientsZip(
  clients: { id: string; name: string }[],
  allMaps: MindMap[]
): Promise<void> {
  const zip = new JSZip();

  const clientNameById = new Map<string, string>();
  clients.forEach((c) => clientNameById.set(c.id, c.name));

  if (allMaps.length === 0) {
    zip.file('README.txt', 'Nenhum cliente ou sessão encontrada no banco local.');
  } else {
    const usedClientFolders = new Set<string>();

    allMaps.forEach((s, idx) => {
      const clientName = clientNameById.get(s.clientId) || s.clientName || 'Cliente';
      const folderName = sanitizeFilename(clientName);
      usedClientFolders.add(folderName);

      const clientFolder = zip.folder(folderName) || zip;
      const md = exportToMarkdown(s);
      let sessionName = sanitizeFilename(s.sessionDate || s.title || `sessao_${idx + 1}`);
      clientFolder.file(`${sessionName}.md`, md);
    });
  }

  const today = new Date().toISOString().slice(0, 10);
  const blob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  downloadBlob(blob, `sessionmap_todos_clientes_${today}.zip`);
}

/**
 * Copy text to clipboard with feedback
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Exports mindmap SVG to file
 */
export function exportToSVG(svgElement: SVGSVGElement, title: string, theme: 'papel' | 'noite') {
  const clone = svgElement.cloneNode(true) as SVGSVGElement;
  const bbox = svgElement.getBBox();
  const padding = 60;
  const width = Math.max(800, bbox.width + padding * 2);
  const height = Math.max(600, bbox.height + padding * 2);

  clone.setAttribute('viewBox', `${bbox.x - padding} ${bbox.y - padding} ${width} ${height}`);
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

  // Insert background rect if needed
  const bgColor = theme === 'noite' ? '#0F172A' : '#FBFBF9';
  const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  bgRect.setAttribute('x', `${bbox.x - padding}`);
  bgRect.setAttribute('y', `${bbox.y - padding}`);
  bgRect.setAttribute('width', String(width));
  bgRect.setAttribute('height', String(height));
  bgRect.setAttribute('fill', bgColor);
  clone.insertBefore(bgRect, clone.firstChild);

  const serializer = new XMLSerializer();
  const svgString = serializer.serializeToString(clone);
  downloadFile(svgString, `${sanitizeFilename(title)}.svg`, 'image/svg+xml');
}

/**
 * Exports mindmap SVG to PNG (2x resolution)
 */
export function exportToPNG(
  svgElement: SVGSVGElement,
  title: string,
  theme: 'papel' | 'noite',
  scale: number = 2
): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const clone = svgElement.cloneNode(true) as SVGSVGElement;
      const bbox = svgElement.getBBox();
      const padding = 60;
      const width = Math.max(800, Math.ceil(bbox.width + padding * 2));
      const height = Math.max(600, Math.ceil(bbox.height + padding * 2));

      clone.setAttribute('viewBox', `${bbox.x - padding} ${bbox.y - padding} ${width} ${height}`);
      clone.setAttribute('width', String(width));
      clone.setAttribute('height', String(height));
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

      const bgColor = theme === 'noite' ? '#0F172A' : '#FBFBF9';
      const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      bgRect.setAttribute('x', `${bbox.x - padding}`);
      bgRect.setAttribute('y', `${bbox.y - padding}`);
      bgRect.setAttribute('width', String(width));
      bgRect.setAttribute('height', String(height));
      bgRect.setAttribute('fill', bgColor);
      clone.insertBefore(bgRect, clone.firstChild);

      const serializer = new XMLSerializer();
      const svgString = serializer.serializeToString(clone);
      const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
      const URLObj = window.URL || window.webkitURL || window;
      const blobURL = URLObj.createObjectURL(svgBlob);

      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = width * scale;
        canvas.height = height * scale;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          URLObj.revokeObjectURL(blobURL);
          reject(new Error('Canvas context not available'));
          return;
        }
        ctx.scale(scale, scale);
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(image, 0, 0);

        canvas.toBlob((pngBlob) => {
          URLObj.revokeObjectURL(blobURL);
          if (pngBlob) {
            const pngUrl = URLObj.createObjectURL(pngBlob);
            const a = document.createElement('a');
            a.href = pngUrl;
            a.download = `${sanitizeFilename(title)}.png`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URLObj.revokeObjectURL(pngUrl);
            resolve();
          } else {
            reject(new Error('Failed to create PNG blob'));
          }
        }, 'image/png');
      };

      image.onerror = (err) => {
        URLObj.revokeObjectURL(blobURL);
        reject(err);
      };

      image.src = blobURL;
    } catch (err) {
      reject(err);
    }
  });
}

export function sanitizeFilename(name: string): string {
  return name.trim().replace(/[/\\?%*:|"<>]/g, '-').replace(/\s+/g, '_') || 'mapa';
}

/**
 * Parses OPML string to MindMapNode
 */
export function parseOPML(xmlText: string, defaultTitle: string = 'Mapa Importado'): MindMapNode {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'text/xml');
  const title = doc.querySelector('head > title')?.textContent || defaultTitle;
  const rootOutline = doc.querySelector('body > outline');

  function parseOutline(el: Element): MindMapNode {
    const text = el.getAttribute('text') || el.getAttribute('title') || 'Nó';
    const children: MindMapNode[] = [];
    for (let i = 0; i < el.children.length; i++) {
      const childEl = el.children[i];
      if (childEl.tagName.toLowerCase() === 'outline') {
        children.push(parseOutline(childEl));
      }
    }
    return {
      id: generateNodeId(),
      text,
      children,
    };
  }

  if (rootOutline) {
    return parseOutline(rootOutline);
  }

  return {
    id: generateNodeId(),
    text: title,
    children: [],
  };
}
