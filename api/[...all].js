// Vercel serverless entry: every /api/* route lands here and reuses the
// same request handler as the local server. Static files come from /public.
import { handleRequest } from "../server.js";

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  await handleRequest(req, res);
}
