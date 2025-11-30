import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  component: Home,
});

function Home() {
  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Login</h1>
      <form className="flex flex-col gap-4 max-w-sm">
        <div>
          <label htmlFor="email" className="block mb-1">
            Email
          </label>
          <input type="email" id="email" className="border p-2 rounded w-full" placeholder="Enter your email" />
        </div>
        <div>
          <label htmlFor="password" className="block mb-1">
            Password
          </label>
          <input type="password" id="password" className="border p-2 rounded w-full" placeholder="Enter your password" />
        </div>
        <button type="submit" className="bg-blue-500 text-white p-2 rounded hover:bg-blue-600">
          Login
        </button>
      </form>
    </div>
  );
}
