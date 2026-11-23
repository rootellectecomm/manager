import { PageHeader } from "@/components/ui";
import { Office } from "@/components/office";
import { officeAssignAction } from "../../actions";

export const metadata = { title: "HQ — Live Office" };

export default function OfficePage() {
  return (
    <>
      <PageHeader title="Rootellect HQ" subtitle="Your AI company, live. Agents walk to their desks when work is assigned, queue at your office when they need a signature, and gather in the boardroom for debates. Click anyone and ask what they're doing." />
      <Office assignAction={officeAssignAction} />
    </>
  );
}
