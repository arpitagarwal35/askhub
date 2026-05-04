import { NavLink } from "react-router-dom";

export default function Layout({ children }) {
  const navClass = ({ isActive }) =>
    `px-4 py-2 rounded text-sm font-medium transition-colors ${
      isActive ? "bg-black text-white" : "text-gray-600 hover:bg-gray-100"
    }`;

  return (
    <div className="h-screen flex flex-col">
      <header className="border-b px-6 py-3 flex items-center gap-6 bg-white">
        <span className="font-semibold text-lg">AI Knowledge Assistant</span>
        <nav className="flex gap-2">
          <NavLink to="/" end className={navClass}>
            Chat
          </NavLink>
          <NavLink to="/sources" className={navClass}>
            Sources
          </NavLink>
        </nav>
      </header>
      <main className="flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
