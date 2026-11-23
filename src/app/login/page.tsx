import { redirect } from "next/navigation";
import { currentUser } from "../lib/session";
import { loginAction } from "../actions";
import { ActionForm } from "@/components/client";
import { inputCls } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await currentUser()) redirect("/");
  const { next } = await searchParams;
  return (
    <div className="grid min-h-screen place-items-center bg-forest-900 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center text-white">
          <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-xl bg-forest-700 text-lg font-semibold text-gold-300 ring-1 ring-gold-500/40">R</div>
          <h1 className="serif text-2xl font-semibold">Rootellect OS</h1>
          <p className="mt-1 text-sm text-forest-200">Founder control plane</p>
        </div>
        <div className="surface rounded-2xl p-6 shadow-xl">
          <ActionForm action={loginAction} submit="Sign in">
            <input type="hidden" name="next" value={next && next.startsWith("/") ? next : "/"} />
            <label className="mb-3 block text-sm"><span className="mb-1 block font-medium">Email</span><input name="email" type="email" required autoComplete="username" className={inputCls} /></label>
            <label className="mb-3 block text-sm"><span className="mb-1 block font-medium">Password</span><input name="password" type="password" required autoComplete="current-password" className={inputCls} /></label>
            <label className="block text-sm"><span className="mb-1 block font-medium">Authenticator code <span className="muted font-normal">(if two-factor is on)</span></span><input name="totp" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" className={inputCls} /></label>
          </ActionForm>
        </div>
        <p className="mt-6 text-center text-xs text-forest-200">No account yet? Run <code className="text-gold-300">npm run founder:create</code></p>
      </div>
    </div>
  );
}
