export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-md text-center">
        <h1 className="text-xl font-semibold sm:text-2xl">
          消費シナリオシミュレータ
        </h1>
        <p className="mt-4 text-base text-gray-500" role="status">
          Loading scenarios…
        </p>
      </div>
    </main>
  );
}
