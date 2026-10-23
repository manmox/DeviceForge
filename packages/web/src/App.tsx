import { useEffect, useState } from 'react';
import { Loader2, Menu } from 'lucide-react';
import { DictionaryDialog } from './components/DictionaryDialog';
import { NewDeviceDialog } from './components/NewDeviceDialog';
import { Sidebar } from './components/Sidebar';
import { Toast } from './components/Toast';
import { Welcome } from './components/Welcome';
import { DeviceView } from './pages/DeviceView';
import { useAppStore } from './store';
import { connectWs } from './ws/client';

let booted = false;

export default function App() {
  const init = useAppStore((state) => state.init);
  const device = useAppStore((state) => state.device);
  const detailLoading = useAppStore((state) => state.detailLoading);
  const dictionaryOpen = useAppStore(
    (state) => state.dictionaryDialog.open,
  );

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [initialPreset, setInitialPreset] = useState<string | null>(null);

  useEffect(() => {
    if (booted) return;
    booted = true;
    void init();
    connectWs();
  }, [init]);

  function openNew(presetFile?: string) {
    setInitialPreset(presetFile ?? null);
    setNewOpen(true);
  }

  function closeNew() {
    setNewOpen(false);
    setInitialPreset(null);
  }

  return (
    <div className="flex h-dvh overflow-hidden bg-ink-950 text-mist-200">
      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onNew={() => openNew()}
      />

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-white/10 px-4 lg:hidden">
          <button
            className="btn btn-ghost rounded-lg p-2"
            onClick={() => setSidebarOpen(true)}
            aria-label="打开侧边栏"
          >
            <Menu className="h-4 w-4" />
          </button>
          <span className="truncate text-sm font-medium text-mist-200">
            {device?.config.name ?? 'DeviceForge'}
          </span>
        </div>

        {detailLoading && !device ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-mist-500" />
          </div>
        ) : device ? (
          <DeviceView key={device.config.id} device={device} />
        ) : (
          <Welcome onNew={openNew} />
        )}
      </main>

      {newOpen && (
        <NewDeviceDialog onClose={closeNew} initialPresetFile={initialPreset} />
      )}
      {dictionaryOpen && <DictionaryDialog />}
      <Toast />
    </div>
  );
}
