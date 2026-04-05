# HumorFlavor Manager

Minimal Next.js tool for authenticated admin users to manage humor flavors and ordered prompt-chain steps, then test caption generation via `api.almostcrackd.ai`.

## Run locally

1. Install dependencies:

```bash
npm install
```

2. Configure env:

```bash
cp .env.example .env.local
```

3. Start development server:

```bash
npm run dev
```

4. Validate:

```bash
npm run lint
npm run build
```

## Data model assumptions

- `profiles` table has `id`, `is_superadmin`, `is_matrix_admin`
- `humor_flavors` table has `id`, `name`, `description`, timestamps
- `humor_flavor_steps` table has `id`, `humor_flavor_id`, `order_index`, `title`, `prompt_template`, `input_source`
- `caption_history` table has `id`, `humor_flavor_id`, `image_url`, `captions`, `trace`, `created_at`

## Deployment

- Push to GitHub.
- Import to Vercel.
- Ensure all env variables are configured.
- Disable deployment protection in Vercel project settings for Incognito testing.
