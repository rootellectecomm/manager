import Link from "next/link";
export default function NotFound() {
  return <div className="grid min-h-[60vh] place-items-center text-center"><div><h1 className="serif text-2xl font-semibold">Not found</h1><p className="muted mt-1 text-sm">That record doesn’t exist or was removed.</p><Link href="/" className="accent mt-4 inline-block text-sm font-medium">Back to Mission Control</Link></div></div>;
}
