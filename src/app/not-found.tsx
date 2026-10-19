import Link from "next/link";
export default function NotFound() {
  return <div className="empty"><h2>Not found</h2><p>That page or job does not exist (it may have been merged into a duplicate).</p><Link href="/jobs">Back to search</Link></div>;
}
