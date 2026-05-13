import { DiscordContextProvider } from '../hooks/useDiscordSdk'
import { Activity } from './Activity'
import { SyncContextProvider } from '@robojs/sync'
import './App.css'
import { Toaster } from "@/components/ui/sonner"

/**
 * 🔒 Set `authenticate` to true to enable Discord authentication
 * You can also set the `scope` prop to request additional permissions
 *
 * Example:
 * ```tsx
 * <DiscordContextProvider authenticate scope={['identify', 'guilds']}>
 * ```
 */
export default function App() {
	return (
		<DiscordContextProvider authenticate scope={['identify']}>
			<SyncContextProvider>
				<Activity />
        <Toaster position="bottom-left" />
			</SyncContextProvider>
		</DiscordContextProvider>
	)
}
