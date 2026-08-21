import { AdminConsole } from '../components/AdminConsole';

export default function AdminHomePage() {
  return (
    <main className="page-shell">
      <header className="topbar">
        <div>
          <span className="eyebrow">CAR RENTAL PLATFORM</span>
          <h1>Administration</h1>
        </div>
        <span className="environment">Identity operations</span>
      </header>
      <AdminConsole />
    </main>
  );
}
