import Link from "next/link";
import { InboxList } from "./inbox-list";

export default function InboxPage() {
  return (
    <s-page heading="Inbox">
      {/* The weekly plan has its own page until the inbox follows the design (it then sits on top here). */}
      <p className="mt-0 mb-3">
        <Link href="/plan" className="font-semibold">
          This week&apos;s plan →
        </Link>
      </p>
      <InboxList />
    </s-page>
  );
}
