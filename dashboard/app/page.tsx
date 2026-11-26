import { Dashboard } from '@/components/dashboard/dashboard';
import { Suspense } from 'react';

export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <main>
      <Suspense fallback={null}>
        <Dashboard />
      </Suspense>
    </main>
  );
}
