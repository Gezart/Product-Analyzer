import { ShopStatus } from "./shop-status";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">Unstuck</h1>
      <p className="max-w-md text-lg text-zinc-600 dark:text-zinc-400">
        Find the products that don&apos;t sell, learn why, fix them, and discount
        only what can&apos;t be saved.
      </p>
      <ShopStatus />
    </main>
  );
}
