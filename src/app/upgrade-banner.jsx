import Link from "next/link";

/** "Included from the X plan" with a link to the plans page. */
export function UpgradeBanner({ children }) {
  return (
    <s-banner tone="warning">
      {children}{" "}
      <Link href="/plans" className="font-medium underline">
        See plans
      </Link>
    </s-banner>
  );
}
