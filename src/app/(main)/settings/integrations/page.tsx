import { redirect } from 'next/navigation';

// Atlas is the only integration with a page of its own; the bare path used to 404.
export default function IntegrationsPage() {
  redirect('/settings/integrations/atlas');
}
