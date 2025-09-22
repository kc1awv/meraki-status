import type { Config } from 'tailwindcss'


export default <Config>{
    content: [
        './index.html',
        './src/**/*.{ts,tsx}',
    ],
    theme: { extend: {} },
    plugins: [],
}