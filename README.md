# Ithu Namma Kada

Casual men's wear storefront with:

- `index.html` for the public customer site
- `seller.html` for the locked seller portal
- `api/` for Vercel serverless APIs
- `supabase/schema.sql` for database setup
- `vercel.json` for production security headers

## Local Run

1. Open a terminal in this project folder.
2. Run `npm start`
3. Open `http://localhost:3000`

Local `server.js` still works for local testing, but the Vercel deployment uses the `api/` folder instead of `server.js`.

## Vercel + Supabase Setup

1. Create a Supabase project.
2. Open the Supabase SQL editor.
3. Run [supabase/schema.sql](C:/Users/ELCOT/Documents/website/ITHU%20NAMMA%20KADA/supabase/schema.sql).
4. In Vercel, add these environment variables from [.env.example](C:/Users/ELCOT/Documents/website/ITHU%20NAMMA%20KADA/.env.example):
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SESSION_SECRET`
5. Push this project to GitHub.
6. Import the GitHub repository into Vercel.
7. Deploy.

## Seller Login

- Username: `seller`
- Password: `ChangeMe@123`

Change this after first deployment by updating the `seller_users.password_hash` row in Supabase.

## Important

- Do not expose the Supabase service role key in frontend code.
- Keep `SESSION_SECRET` long and random in production.
- Seller product changes on Vercel now persist in Supabase instead of local JSON files.
