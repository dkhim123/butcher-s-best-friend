# Spot Butchery

A point-of-sale and stock-management web app for **Spot Butchery**.
It tracks daily sales, opening stock, purchase orders, receipts, and
end-of-day reports across one or more branches.

## Tech stack (in plain English)

| What it is | Why we use it |
|---|---|
| **Vite + React + TypeScript** | Fast development server and strong type-checking so we catch bugs while typing. |
| **Tailwind CSS + shadcn/ui** | Pre-styled, accessible UI components (buttons, cards, dialogs) we can drop in. |
| **React Router** | Moves the user between pages (Login, Signup, Home, Settings) without a full reload. |
| **Supabase** | The cloud Postgres database that stores users, products, sales, and stock. |
| **bcryptjs** | Hashes passwords before saving them to the database. |
| **React Query** | Caches data fetched from Supabase so screens load instantly the second time. |

## Getting started

### 1. Tools you need installed

```bash
node --version   # should be >= 20
npm --version    # should be >= 10
```

If `node` is missing, install it from <https://nodejs.org> (LTS version).

### 2. Install dependencies

```bash
npm install
```

This downloads everything listed in `package.json` into `node_modules/`.

### 3. Configure your Supabase database

Copy `.env.example` to `.env` and fill in the values from your Supabase project
(Project Settings → API):

```bash
VITE_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...your-anon-key...
```

### 4. Apply the database schema

Open the Supabase Dashboard → SQL Editor → paste the contents of
`supabase/spot-butchery-schema.sql` → click **Run**.

This creates all tables (`organisations`, `branches`, `profiles`, `products`,
`stock_entries`, `purchase_orders`, `sales`, `sale_items`, `receipt_counter`).

### 5. Start the dev server

```bash
npm run dev
```

The app will be available at <http://localhost:4100>.

### 6. Create your first admin

1. Open <http://localhost:4100/signup>
2. Fill in the form — this creates your business + your admin account.
3. After signup you are redirected to the POS dashboard.

## Folder structure

```
src/
├── App.tsx                 # routes + top-level providers
├── main.tsx                # React entry point
├── pages/                  # one file per route
│   ├── Login.tsx
│   ├── Signup.tsx
│   ├── Index.tsx           # main dashboard (POS, Stock, Reports, ...)
│   ├── Settings.tsx
│   └── ...
├── components/
│   ├── auth/               # ProtectedRoute
│   ├── butchery/           # business components (POS, Receipt, etc.)
│   └── ui/                 # shadcn/ui primitives (button, card, ...)
├── contexts/
│   └── AuthContext.tsx     # signIn / signUp / signOut + session state
└── lib/
    ├── supabase.ts         # Supabase client
    ├── database.types.ts   # TypeScript types matching the DB
    └── butchery-store.ts   # data hooks (useProducts, useSales, ...)

supabase/
├── README.md                       # how to install + what the schema contains
└── spot-butchery-schema.sql        # paste this into Supabase SQL Editor → Run
```

> The schema file starts by **dropping** any existing Spot Butchery
> tables, then rebuilds them — so re-running it gives you a clean DB.

## NPM scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the local dev server with hot-reload. |
| `npm run build` | Build the production bundle into `dist/`. |
| `npm run preview` | Preview the production build locally. |
| `npm run lint` | Run ESLint to find style/quality issues. |
| `npm test` | Run unit tests once. |
| `npm run test:watch` | Run tests in watch mode. |
