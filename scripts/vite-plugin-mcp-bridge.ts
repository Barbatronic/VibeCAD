/**
 * Pont MCP (serveur de développement seulement) : relaie les appels d'outils du serveur MCP
 * (`mcp/vibecad-mcp.mjs`) vers l'onglet VibeCAD ouvert, par le WebSocket de Vite.
 *
 *   serveur MCP ──POST /__vibecad_mcp──► plugin ──ws « vibecad-mcp:call »──► onglet (src/app/mcp-bridge.ts)
 *               ◄────── réponse JSON ─────        ◄──ws « vibecad-mcp:result »──
 *
 * Seul le dernier onglet ouvert (ou revenu au premier plan) exécute les appels : deux onglets ne
 * modifient jamais le même projet en même temps. Le point d'entrée refuse les requêtes venues d'un
 * navigateur (en-tête Origin) et exige l'en-tête `X-VibeCAD-MCP: 1`.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin, WebSocketClient } from 'vite';

const ROUTE = '/__vibecad_mcp';
const CALL_TIMEOUT_MS = 120_000;

interface Pending {
  resolve: (value: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      body += chunk;
      if (body.length > 5_000_000) reject(new Error('Requête trop volumineuse.'));
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(value));
}

export function mcpBridgePlugin(): Plugin {
  return {
    name: 'vibecad-mcp-bridge',
    apply: 'serve',
    configureServer(server) {
      /** Onglets qui se sont annoncés, du plus ancien au plus récent. */
      let tabs: WebSocketClient[] = [];
      const pending = new Map<number, Pending>();
      let seq = 0;

      const currentTab = (): WebSocketClient | null => {
        tabs = tabs.filter((t) => server.ws.clients.has(t));
        return tabs[tabs.length - 1] ?? null;
      };

      server.ws.on('vibecad-mcp:hello', (_data: unknown, client: WebSocketClient) => {
        tabs = [...tabs.filter((t) => t !== client), client];
      });
      server.ws.on('vibecad-mcp:result', (data: { id?: number }) => {
        const p = typeof data?.id === 'number' ? pending.get(data.id) : undefined;
        if (!p) return;
        clearTimeout(p.timer);
        pending.delete(data.id!);
        p.resolve(data);
      });

      server.middlewares.use(ROUTE, (req, res) => {
        void (async () => {
          if (req.method !== 'POST' || req.headers['x-vibecad-mcp'] !== '1' || req.headers.origin) {
            return sendJson(res, 403, { ok: false, error: 'Accès refusé.' });
          }
          let call: { tool?: unknown; args?: unknown };
          try {
            call = JSON.parse(await readBody(req)) as typeof call;
          } catch {
            return sendJson(res, 400, { ok: false, error: 'Requête illisible.' });
          }
          if (typeof call.tool !== 'string') return sendJson(res, 400, { ok: false, error: 'Outil manquant.' });
          const tab = currentTab();
          if (!tab) {
            return sendJson(res, 503, { ok: false, error: `Aucun onglet VibeCAD n'est ouvert : ouvrez http://localhost:${server.config.server.port ?? 5173}/ dans le navigateur.` });
          }
          const id = ++seq;
          const answer = await new Promise<unknown>((resolve) => {
            const timer = setTimeout(() => {
              pending.delete(id);
              resolve({ ok: false, error: "L'onglet VibeCAD n'a pas répondu à temps (calcul trop long, ou onglet en arrière-plan ?)." });
            }, CALL_TIMEOUT_MS);
            pending.set(id, { resolve, timer });
            tab.send('vibecad-mcp:call', { id, tool: call.tool, args: call.args ?? {} });
          });
          sendJson(res, 200, answer);
        })().catch((err: unknown) => sendJson(res, 500, { ok: false, error: (err as Error).message }));
      });
    },
  };
}
