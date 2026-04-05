import ExpenseScanner from "./components/ExpenseScanner";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function Home() {
  return (
    <main className="min-h-screen bg-gray-950 text-white">
      <ExpenseScanner />
    </main>
  );
}
