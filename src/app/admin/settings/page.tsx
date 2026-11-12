import { Card, Check, Field, Flash, Page, Submit, TextArea } from "@/components/admin/ui";
import { getSettings } from "@/server/admin";
import { adminCtx } from "@/server/adminSession";
import { getPaymentProvider } from "@/server/payments";
import { saveNotifications, saveStore } from "../actions";

export const metadata = { title: "Settings" };

export default async function SettingsPage({ searchParams }: PageProps<"/admin/settings">) {
  const ctx = await adminCtx();
  if (!ctx.admin) return null;
  const [{ store, notifications }, params] = await Promise.all([getSettings(ctx), searchParams]);
  const text = (source: Record<string, string | boolean | null>, key: string) => (typeof source[key] === "string" ? (source[key] as string) : "");
  const flag = (key: string, fallback: boolean) => (typeof notifications[key] === "boolean" ? (notifications[key] as boolean) : fallback);
  const connected = (ok: boolean) => <span className={ok ? "text-olive-700" : "text-terracotta-700"}>{ok ? "Connected" : "Not connected"}</span>;

  return (
    <Page title="Settings" eyebrow="Administrators only">
      <Flash params={params} />
      <Card title="Store information" description="Printed on invoices and shown on the contact page. An invoice is not valid without the legal name, address and VAT number.">
        <form action={saveStore} className="grid gap-4 sm:grid-cols-2">
          <Field label="Trading name" name="name" defaultValue={text(store, "name")} />
          <Field label="Legal entity name" name="legalName" defaultValue={text(store, "legalName")} />
          <TextArea label="Registered address" name="address" rows={3} defaultValue={text(store, "address")} className="sm:col-span-2" />
          <Field label="VAT number" name="vatNumber" defaultValue={text(store, "vatNumber")} />
          <Field label="Enterprise number" name="enterpriseNumber" defaultValue={text(store, "enterpriseNumber")} />
          <Field label="Contact email" name="email" type="email" defaultValue={text(store, "email")} />
          <Field label="Contact phone" name="phone" defaultValue={text(store, "phone")} />
          <div className="sm:col-span-2">
            <Submit>Save store information</Submit>
          </div>
        </form>
      </Card>

      <Card title="Order notifications" description="Who is told when an order has been paid. These preferences are saved now; messages start being sent once the email, WhatsApp and SMS services are connected in the notifications phase.">
        <form action={saveNotifications} className="grid gap-4 sm:grid-cols-2">
          <Field label="Email recipient" name="emailRecipient" type="email" defaultValue={text(notifications, "emailRecipient")} />
          <Check label="Notify by email" name="notifyByEmail" defaultChecked={flag("notifyByEmail", true)} className="self-end" />
          <Field label="WhatsApp business number" name="whatsappBusinessNumber" defaultValue={text(notifications, "whatsappBusinessNumber")} hint="The number registered with the WhatsApp Business Platform." />
          <Field label="WhatsApp recipient" name="whatsappRecipient" defaultValue={text(notifications, "whatsappRecipient")} hint="International format, e.g. +32470123456." />
          <Check label="Notify by WhatsApp" name="notifyByWhatsapp" defaultChecked={flag("notifyByWhatsapp", true)} />
          <span />
          <Field label="SMS recipient (optional)" name="smsRecipient" defaultValue={text(notifications, "smsRecipient")} />
          <Check label="Notify by SMS" name="notifyBySms" defaultChecked={flag("notifyBySms", false)} className="self-end" />
          <div className="sm:col-span-2">
            <Submit>Save notification settings</Submit>
          </div>
        </form>
      </Card>

      <Card title="Connections" description="Secret keys are never entered or shown here. They live in the server’s environment settings.">
        <dl className="divide-y divide-ink/10">
          {[
            ["Stripe payments", connected(getPaymentProvider() !== null)],
            ["Mollie payments", <span key="m" className="text-stone-700">Not built</span>],
            ["Email (Resend)", connected(Boolean(process.env.RESEND_API_KEY))],
            ["WhatsApp Business Platform", connected(Boolean(process.env.WHATSAPP_ACCESS_TOKEN))],
            ["SMS (Twilio)", connected(Boolean(process.env.TWILIO_AUTH_TOKEN))],
            ["Shipping carrier", <span key="s" className="text-stone-700">Not built</span>],
          ].map(([label, value]) => (
            <div key={String(label)} className="flex justify-between gap-6 py-3">
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <p className="text-small mt-4 text-stone-700">Currency is fixed to euro. VAT rates are under Shipping &amp; VAT; staff accounts under Staff.</p>
      </Card>
    </Page>
  );
}
