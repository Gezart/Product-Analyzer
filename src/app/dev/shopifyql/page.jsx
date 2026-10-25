import { notFound } from "next/navigation";
import { ShopifyqlCheck } from "./check";

// Development only: the ShopifyQL check doesn't exist in production.
export default function ShopifyqlCheckPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <ShopifyqlCheck />;
}
