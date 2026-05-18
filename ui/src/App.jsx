import { useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout.jsx";
import ChatPage from "./pages/ChatPage.jsx";
import SourcesPage from "./pages/SourcesPage.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import { getApiKey, setApiKey, clearApiKey, getWorkspaceName, setWorkspaceName, clearWorkspaceName } from "./lib/api.js";

export default function App() {
  const [authed, setAuthed] = useState(() => !!getApiKey());
  const [workspaceName, setWorkspaceNameState] = useState(() => getWorkspaceName());

  if (!authed) {
    return (
      <LoginPage
        onLogin={(key, name) => {
          setApiKey(key);
          setWorkspaceName(name);
          setWorkspaceNameState(name);
          setAuthed(true);
        }}
      />
    );
  }

  return (
    <Layout
      workspaceName={workspaceName}
      onLogout={() => { clearApiKey(); clearWorkspaceName(); setAuthed(false); }}
    >
      <Routes>
        <Route path="/" element={<ChatPage />} />
        <Route path="/sources" element={<SourcesPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
