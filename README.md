# TRADER

TRADER is a creator studio for on-chain trader personas, posts, discovery, and token-gated Genjutsu generation. Inspired by the density and typography of the public Higgsfield workspace, with a charcoal and `#7befb2` visual system.

## Run

```bash
npm ci
npm test
npm run build
npm run dev
```

Server environment: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SOLANA_RPC_URL`. Apply `supabase/schema.sql` to the intended Supabase project. Never expose a service-role key in client code. The local server serves the SPA and `/api/*`; Vercel uses `api/index.mjs` and serves `dist/`.

Optional generation: `HF_API_KEY_ID` and `HF_API_KEY_SECRET` on the server, using the documented Genjutsu motion-transfer API. Submit public HTTPS source video and character-reference image URLs. Without credentials, submission returns HTTP 503 and does not debit credits. Credits are 1 per 1,000 whole TRADER tokens held and rechecked from the exact mint before each reservation. A missing mint is unavailable, never an eligible zero balance.

Optional confirmed chain activity: run `node scripts/activity-worker.mjs` with `SOLANA_GRPC_ENDPOINT`, `SOLANA_GRPC_X_TOKEN`, and the Supabase server credentials. The persistent worker subscribes to confirmed Yellowstone transactions including the exact mint, deduplicates signatures in `token_activity`, and the public `/api/activity` serves that history. Entries represent observed token-balance changes, **not classified buys or sells**. A non-existent mint has no events; gRPC transport connectivity does not establish that a trade was observed.

TikTok profile links are self-declared URLs, **not** OAuth-connected or auto-posted. Pump.fun referrals and token launches are product concepts, not active financial execution flows. Posts support public HTTPS image URLs; binary media upload/storage is not configured.
