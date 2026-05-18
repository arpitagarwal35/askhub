import { NavLink } from "react-router-dom";

export default function Layout({ children, onLogout, workspaceName }) {
  const navClass = ({ isActive }) =>
    `px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
      isActive ? "bg-gray-900 text-white" : "text-gray-500 hover:text-gray-800 hover:bg-gray-100"
    }`;

  return (
    <div className="h-screen flex flex-col">
      <header className="border-b px-6 py-3 flex items-center gap-6 bg-white shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xl">🔍</span>
          <span className="font-bold text-gray-900 tracking-tight">AskHub</span>
        </div>
        <nav className="flex gap-1 flex-1">
          <NavLink to="/" end className={navClass}>Chat</NavLink>
          <NavLink to="/sources" className={navClass}>Sources</NavLink>
        </nav>
        {workspaceName && (
          <span className="text-xs text-gray-400 bg-gray-100 px-2.5 py-1 rounded-full">
            {workspaceName}
          </span>
        )}
        {onLogout && (
          <button
            onClick={onLogout}
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            Sign out
          </button>
        )}
      </header>
      <main className="flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
