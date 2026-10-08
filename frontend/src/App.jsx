import { useState } from "react";


import ApiManager from "./pages/ApiManager";
import DataExplorer from "./pages/DataExplorer";

import "./App.css";


//export default App;

export default function App() {
    const [activeModule, setActiveModule] =
        useState('api-manager');

    return (
        <div className='min-h-screen bg-slate-100'>
            <nav className='border-b border-slate-200 bg-white'>
                <div className='mx-auto flex max-w-7xl gap-2 px-6 py-3'>
                    <button
                        className={`rounded-lg px-4 py-2 text-sm font-medium ${
                            activeModule ===
                            'api-manager'
                                ? 'bg-slate-900 text-white'
                                : 'text-slate-600 hover:bg-slate-100'
                        }`}
                        onClick={() =>
                            setActiveModule(
                                'api-manager',
                            )
                        }
                        type='button'
                    >
                        API Manager
                    </button>

                    <button
                        className={`rounded-lg px-4 py-2 text-sm font-medium ${
                            activeModule ===
                            'data-explorer'
                                ? 'bg-slate-900 text-white'
                                : 'text-slate-600 hover:bg-slate-100'
                        }`}
                        onClick={() =>
                            setActiveModule(
                                'data-explorer',
                            )
                        }
                        type='button'
                    >
                        Explorador de datos
                    </button>
                </div>
            </nav>

            {activeModule === 'api-manager' ? (
                <ApiManager />
            ) : (
                <DataExplorer />
            )}
        </div>
    );
}


