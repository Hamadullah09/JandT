import { Sidebar } from '@/components/layout/Sidebar';
import { TabStrip } from '@/components/layout/TabStrip';
import { TopBar } from '@/components/layout/TopBar';

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden bg-white">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <TabStrip />
        <main className="min-h-0 flex-1 overflow-auto bg-white thin-scroll">{children}</main>
      </div>
    </div>
  );
}
