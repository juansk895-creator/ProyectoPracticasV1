const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api';

export async function apiRequest(
    endpoint,
    options = {},
) {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        headers: {
            'Content-Type': 'application/json',
            ...API_BASE_URL(options.headers || {}),
        },
        ...options,
    },);

    let payload = null;

    try {
        
    }

}




