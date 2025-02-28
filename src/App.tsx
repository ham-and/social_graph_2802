import React, { useState } from 'react';
import { Search, Users, UserPlus, UsersRound, Loader2, AlertCircle, ChevronDown, ChevronUp, ArrowLeft, Heart, Music, ArrowUpDown, LogIn } from 'lucide-react';

// Constants for OAuth
const CLIENT_ID = 'PKSAtFElFd989tO0uR1La2nk2es8Jupo';
const REDIRECT_URI = 'https://lively-mandazi-675d66.netlify.app/.netlify/functions/auth';

interface User {
  id: number;
  username: string;
  permalink_url: string;
  avatar_url: string;
  followers_count?: number;
  followings_count?: number;
}

interface Stats {
  followersCount: number;
  followingsCount: number;
  totalFollowings: number;
}

interface SuggestedUser extends User {
  mutualCount: number;
  mutualConnections: User[];
}

interface Track {
  id: number;
  title: string;
  permalink_url: string;
  artwork_url: string;
  created_at: string;
  user: {
    username: string;
    avatar_url: string;
  };
  likedBy: User[];
}

type SortOption = 'newest' | 'oldest' | 'popular';

const DEFAULT_AUTH_TOKEN = '2-299772--SnEFFFFifg6lbOrLh9EgWm5';
const MUTUAL_FOLLOWS_LIMIT = 50;
const BATCH_SIZE = 5; // Number of users to process in parallel

function App() {
  const [profileUrl, setProfileUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [mutualFollowers, setMutualFollowers] = useState<User[]>([]);
  const [mutualFollows, setMutualFollows] = useState<User[]>([]);
  const [userDetails, setUserDetails] = useState<User | null>(null);
  const [followingsOffset, setFollowingsOffset] = useState(0);
  const [allFollowers, setAllFollowers] = useState<User[]>([]);
  const [allFollowings, setAllFollowings] = useState<User[]>([]);
  const [suggestedUsers, setSuggestedUsers] = useState<SuggestedUser[]>([]);
  const [analyzingSuggestions, setAnalyzingSuggestions] = useState(false);
  const [suggestionProgress, setSuggestionProgress] = useState({ current: 0, total: 0 });
  const [showingLikes, setShowingLikes] = useState(false);
  const [loadingLikes, setLoadingLikes] = useState(false);
  const [likedTracks, setLikedTracks] = useState<Track[]>([]);
  const [sortOption, setSortOption] = useState<SortOption>('popular');
  const [selectedUsers, setSelectedUsers] = useState<Set<number>>(new Set());
  
  // Section collapse states
  const [sectionsCollapsed, setSectionsCollapsed] = useState({
    stats: false,
    mutualFollows: false,
    nonMutuals: false,
    suggestions: false
  });

  const handleLogin = () => {
    // Generate a random state value for security
    const state = Math.random().toString(36).substring(7);
    
    // Construct the authorization URL
    const authUrl = new URL('https://secure.soundcloud.com/authorize');
    authUrl.searchParams.append('client_id', CLIENT_ID);
    authUrl.searchParams.append('redirect_uri', REDIRECT_URI);
    authUrl.searchParams.append('response_type', 'code');
    authUrl.searchParams.append('state', state);
    
    // Redirect to SoundCloud's authorization page
    window.location.href = authUrl.toString();
  };

  const toggleSection = (section: keyof typeof sectionsCollapsed) => {
    setSectionsCollapsed(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  // Use custom token if provided, otherwise use default
  const authToken = DEFAULT_AUTH_TOKEN;

  const cleanUrl = (url: string): string => {
    // Remove leading/trailing whitespace
    let cleaned = url.trim();
    
    // Remove trailing slash if present
    cleaned = cleaned.replace(/\/+$/, '');
    
    // Add https:// if not present
    if (!cleaned.startsWith('http://') && !cleaned.startsWith('https://')) {
      cleaned = 'https://' + cleaned;
    }
    
    return cleaned;
  };

  const resolveProfile = async (url: string) => {
    try {
      const cleanedUrl = cleanUrl(url);
      const response = await fetch(
        `https://api.soundcloud.com/resolve?url=${encodeURIComponent(cleanedUrl)}`,
        {
          headers: {
            'Authorization': `OAuth ${authToken}`,
            'accept': 'application/json; charset=utf-8'
          }
        }
      );
      
      if (!response.ok) {
        throw new Error(`Failed to resolve profile URL: ${response.status} ${response.statusText}`);
      }
      
      const userData = await response.json();
      return userData;
    } catch (error) {
      console.error('Error resolving profile:', error);
      throw error;
    }
  };

  const fetchUserDetails = async (userId: number) => {
    try {
      const response = await fetch(
        `https://api.soundcloud.com/users/${userId}`,
        {
          headers: {
            'Authorization': `OAuth ${authToken}`,
            'accept': 'application/json; charset=utf-8'
          }
        }
      );
      
      if (!response.ok) {
        throw new Error(`Failed to fetch user details: ${response.status} ${response.statusText}`);
      }
      
      const userData = await response.json();
      setUserDetails(userData);
      return userData;
    } catch (error) {
      console.error('Error fetching user details:', error);
      throw error;
    }
  };

  const updateFollowerLists = (followers: User[], followings: User[]) => {
    const followingIds = new Set(followings.map(user => user.id));
    
    // Find mutual followers who you don't follow back
    const nonMutuals = followers.filter(user => !followingIds.has(user.id));
    setMutualFollowers(nonMutuals);

    // Find mutual follows (users who follow you and you follow them)
    const mutuals = followers.filter(user => followingIds.has(user.id));
    setMutualFollows(mutuals);
  };

  const analyzeSocialGraph = async () => {
    if (!profileUrl.trim()) {
      setError('Please enter a SoundCloud profile URL');
      return;
    }

    setLoading(true);
    setError(null);
    setFollowingsOffset(0);
    setAllFollowers([]);
    setAllFollowings([]);
    setSuggestedUsers([]);
    setShowingLikes(false);
    setLikedTracks([]);
    setSelectedUsers(new Set());
    
    try {
      // First resolve the profile URL to get the user ID
      const resolvedUser = await resolveProfile(profileUrl);
      const userId = resolvedUser.id;

      // Fetch user details
      const userData = await fetchUserDetails(userId);

      // Fetch followers
      const followersResponse = await fetch(
        `https://api.soundcloud.com/users/${userId}/followers?limit=200`,
        {
          headers: {
            'Authorization': `OAuth ${authToken}`,
            'accept': 'application/json; charset=utf-8'
          }
        }
      );
      
      if (!followersResponse.ok) {
        throw new Error(`Failed to fetch followers: ${followersResponse.status} ${followersResponse.statusText}`);
      }
      
      const followersData = await followersResponse.json();

      // Fetch followings
      const followingsResponse = await fetch(
        `https://api.soundcloud.com/users/${userId}/followings?limit=200`,
        {
          headers: {
            'Authorization': `OAuth ${authToken}`,
            'accept': 'application/json; charset=utf-8'
          }
        }
      );
      
      if (!followingsResponse.ok) {
        throw new Error(`Failed to fetch followings: ${followingsResponse.status} ${followingsResponse.statusText}`);
      }
      
      const followingsData = await followingsResponse.json();

      // Store all followers and followings
      setAllFollowers(followersData.collection);
      setAllFollowings(followingsData.collection);

      // Set total counts
      setStats({
        followersCount: followersData.collection.length,
        followingsCount: followingsData.collection.length,
        totalFollowings: userData.followings_count || 0
      });

      // Update mutual and non-mutual lists
      updateFollowerLists(followersData.collection, followingsData.collection);

      // Expand all sections when new data is loaded
      setSectionsCollapsed({
        stats: false,
        mutualFollows: false,
        nonMutuals: false,
        suggestions: false
      });

    } catch (error) {
      console.error('Error fetching data:', error);
      setError(error instanceof Error ? error.message : 'An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  const loadMoreFollowings = async () => {
    if (!stats || !userDetails) return;
    
    const newOffset = followingsOffset + 200;
    // Calculate how many more followings we can fetch
    const remainingFollowings = userDetails.followings_count - stats.followingsCount;
    const limit = Math.min(200, remainingFollowings);
    
    if (limit <= 0) return;
    
    try {
      const response = await fetch(
        `https://api.soundcloud.com/users/${userDetails.id}/followings?limit=${limit}&offset=${newOffset}`,
        {
          headers: {
            'Authorization': `OAuth ${authToken}`,
            'accept': 'application/json; charset=utf-8'
          }
        }
      );
      
      if (!response.ok) {
        throw new Error(`Failed to load more followings: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      
      setFollowingsOffset(newOffset);
      
      // Update all followings list
      const updatedFollowings = [...allFollowings, ...data.collection];
      setAllFollowings(updatedFollowings);
      
      // Update stats with new followings count
      setStats({
        ...stats,
        followingsCount: Math.min(
          stats.followingsCount + data.collection.length,
          userDetails.followings_count
        )
      });

      // Update mutual and non-mutual lists with the new followings
      updateFollowerLists(allFollowers, updatedFollowings);
    } catch (error) {
      console.error('Error loading more followings:', error);
      setError(error instanceof Error ? error.message : 'Failed to load more followings');
    }
  };

  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  const findSuggestedFollows = async () => {
    if (!mutualFollows.length) return;
    
    setAnalyzingSuggestions(true);
    setError(null);
    setSuggestedUsers([]);
    
    const limitedMutuals = mutualFollows.slice(0, MUTUAL_FOLLOWS_LIMIT);
    setSuggestionProgress({ current: 0, total: limitedMutuals.length });
    
    const myFollowingIds = new Set(allFollowings.map(user => user.id));
    const suggestedUsersMap = new Map<number, SuggestedUser>();

    // Process mutual follows in batches
    for (let i = 0; i < limitedMutuals.length; i += BATCH_SIZE) {
      const batch = limitedMutuals.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(async (mutualFollow) => {
        try {
          // Fetch mutual follow's followers
          const response = await fetch(
            `https://api.soundcloud.com/users/${mutualFollow.id}/followers?limit=200`,
            {
              headers: {
                'Authorization': `OAuth ${authToken}`,
                'accept': 'application/json; charset=utf-8'
              }
            }
          );
          
          if (!response.ok) {
            throw new Error(`Failed to fetch followers for ${mutualFollow.username}`);
          }
          
          const data = await response.json();
          const followers = data.collection;

          // Fetch mutual follow's followings
          const followingsResponse = await fetch(
            `https://api.soundcloud.com/users/${mutualFollow.id}/followings?limit=200`,
            {
              headers: {
                'Authorization': `OAuth ${authToken}`,
                'accept': 'application/json; charset=utf-8'
              }
            }
          );
          
          if (!followingsResponse.ok) {
            throw new Error(`Failed to fetch followings for ${mutualFollow.username}`);
          }
          
          const followingsData = await followingsResponse.json();
          const followings = followingsData.collection;

          // Find their mutual follows
          const followingIds = new Set(followings.map((user: User) => user.id));
          const theirMutuals = followers.filter((user: User) => followingIds.has(user.id));

          // Add to suggested users map
          theirMutuals.forEach((user: User) => {
            if (user.id === userDetails?.id || myFollowingIds.has(user.id)) return;

            const existing = suggestedUsersMap.get(user.id);
            if (existing) {
              existing.mutualCount++;
              existing.mutualConnections.push(mutualFollow);
            } else {
              suggestedUsersMap.set(user.id, {
                ...user,
                mutualCount: 1,
                mutualConnections: [mutualFollow]
              });
            }
          });

          setSuggestionProgress(prev => ({ ...prev, current: prev.current + 1 }));
          await delay(100); // Small delay to avoid rate limiting
        } catch (error) {
          console.error('Error analyzing mutual follow:', error);
          // Continue processing other users even if one fails
        }
      }));
    }

    // Sort by mutual count and update state
    const sortedSuggestions = Array.from(suggestedUsersMap.values())
      .sort((a, b) => b.mutualCount - a.mutualCount);
    
    setSuggestedUsers(sortedSuggestions);
    setAnalyzingSuggestions(false);
  };

  const fetchLikedTracks = async () => {
    if (!mutualFollows.length) return;
    
    setLoadingLikes(true);
    setError(null);
    
    const trackMap = new Map<number, Track>();
    const usersToFetch = selectedUsers.size > 0 
      ? mutualFollows.filter(user => selectedUsers.has(user.id))
      : mutualFollows.slice(0, MUTUAL_FOLLOWS_LIMIT);
    
    try {
      for (const user of usersToFetch) {
        const response = await fetch(
          `https://api.soundcloud.com/users/${user.id}/likes/tracks?access=playable&limit=5&linked_partitioning=true`,
          {
            headers: {
              'Authorization': `OAuth ${authToken}`,
              'accept': 'application/json; charset=utf-8'
            }
          }
        );
        
        if (!response.ok) {
          console.error(`Failed to fetch likes for ${user.username}`);
          continue;
        }
        
        const data = await response.json();
        const tracks = data.collection;
        
        for (const track of tracks) {
          if (trackMap.has(track.id)) {
            const existingTrack = trackMap.get(track.id)!;
            existingTrack.likedBy.push(user);
          } else {
            trackMap.set(track.id, {
              ...track,
              likedBy: [user]
            });
          }
        }
        
        await delay(100); // Small delay to avoid rate limiting
      }
      
      let tracks = Array.from(trackMap.values());
      
      // Sort tracks based on selected option
      tracks = sortTracks(tracks, sortOption);
      
      setLikedTracks(tracks);
      setShowingLikes(true);
    } catch (error) {
      console.error('Error fetching liked tracks:', error);
      setError(error instanceof Error ? error.message : 'Failed to fetch liked tracks');
    } finally {
      setLoadingLikes(false);
    }
  };

  const sortTracks = (tracks: Track[], option: SortOption): Track[] => {
    switch (option) {
      case 'newest':
        return [...tracks].sort((a, b) => 
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
      case 'oldest':
        return [...tracks].sort((a, b) => 
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
      case 'popular':
        return [...tracks].sort((a, b) => b.likedBy.length - a.likedBy.length);
      default:
        return tracks;
    }
  };

  const toggleUserSelection = (userId: number) => {
    const newSelected = new Set(selectedUsers);
    if (newSelected.has(userId)) {
      newSelected.delete(userId);
    } else {
      newSelected.add(userId);
    }
    setSelectedUsers(newSelected);
  };

  const EmptySection = ({ title, icon: Icon }: { title: string, icon: React.ElementType }) => (
    <div className="bg-white rounded-lg shadow-md p-6 mb-6">
      <div className="flex items-center gap-2 mb-4">
        <Icon className="w-5 h-5 text-gray-600" />
        <h2 className="text-xl font-semibold text-gray-800">{title}</h2>
      </div>
      <div className="flex flex-col items-center justify-center py-12 text-gray-500">
        <div className="mb-4">
          <Icon className="w-12 h-12 text-gray-400" />
        </div>
        <p className="text-center">
          {title === "Suggested Follows" 
            ? "Click 'Find Suggestions' to discover new accounts" 
            : "Click analyze to get started"}
        </p>
      </div>
    </div>
  );

  const CollapsibleSection = ({ 
    title, 
    icon: Icon,
    isCollapsed,
    onToggle,
    children,
    actions
  }: { 
    title: string;
    icon: React.ElementType;
    isCollapsed: boolean;
    onToggle: () => void;
    children: React.ReactNode;
    actions?: React.ReactNode;
  }) => (
    <div className="bg-white rounded-lg shadow-md p-6 mb-6">
      <div className="flex items-center justify-between gap-2 mb-4">
        <button 
          onClick={onToggle}
          className="flex items-center gap-2 text-left"
        >
          <Icon className="w-5 h-5 text-gray-600" />
          <h2 className="text-xl font-semibold text-gray-800">{title}</h2>
          {isCollapsed ? (
            <ChevronDown className="w-5 h-5 text-gray-400" />
          ) : (
            <ChevronUp className="w-5 h-5 text-gray-400" />
          )}
        </button>
        {actions}
      </div>
      {!isCollapsed && children}
    </div>
  );

  const UserGrid = ({ users, title, showMutuals = false }: { 
    users: (User | SuggestedUser)[], 
    title: string,
    showMutuals?: boolean 
  }) => (
    <div>
      {title === "Mutual Follows" && users.length > 50 && (
        <p className="text-sm text-gray-500 mb-4">
          Currently only 50 mutual follows will be considered for suggestions
        </p>
      )}
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {users.map((user) => (
          <a
            key={user.id}
            href={user.permalink_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <img
              src={user.avatar_url}
              alt={user.username}
              className="w-10 h-10 rounded-full"
            />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-gray-800 truncate">
                {user.username}
              </div>
              {showMutuals && 'mutualCount' in user && (
                <div className="text-xs text-gray-500">
                  {user.mutualCount} mutual connection{user.mutualCount !== 1 ? 's' : ''}: {' '}
                  {user.mutualConnections.slice(0, 2).map(mc => mc.username).join(', ')}
                  {user.mutualConnections.length > 2 && ` and ${user.mutualConnections.length - 2} others`}
                </div>
              )}
              {!showMutuals && (
                <div className="text-xs text-gray-500">
                  Following {user.followings_count?.toLocaleString() || '0'} accounts
                </div>
              )}
            </div>
          </a>
        ))}
      </div>
    </div>
  );

  const TrackGrid = ({ tracks }: { tracks: Track[] }) => (
    <div className="grid grid-cols-1 gap-4">
      {tracks.map((track) => (
        <a
          key={track.id}
          href={track.permalink_url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-start gap-4 p-4 rounded-lg hover:bg-gray-50 transition-colors"
        >
          <img
            src={track.artwork_url || track.user.avatar_url}
            alt={track.title}
            className="w-20 h-20 rounded-lg object-cover"
          />
          <div className="flex-1 min-w-0">
            <div className="text-lg font-medium text-gray-800 mb-1">
              {track.title}
            </div>
            <div className="text-sm text-gray-600 mb-2">
              by {track.user.username}
            </div>
            <div className="flex items-center gap-2">
              <Heart className="w-4 h-4 text-sc" />
              <div className="text-sm text-gray-600">
                Liked by {track.likedBy.length} mutual friend{track.likedBy.length !== 1 ? 's' : ''}: {' '}
                {track.likedBy.slice(0, 2).map(user => user.username).join(', ')}
                {track.likedBy.length > 2 && ` and ${track.likedBy.length - 2} others`}
              </div>
            </div>
          </div>
        </a>
      ))}
    </div>
  );

  if (showingLikes) {
    return (
      <div className="min-h-screen bg-gray-100 p-8">
        <div className="max-w-4xl mx-auto">
          <button
            onClick={() => setShowingLikes(false)}
            className="flex items-center gap-2 text-gray-600 hover:text-gray-800 mb-6"
          >
            <ArrowLeft className="w-5 h-5" />
            Back to Follows
          </button>
          
          <div className="bg-white rounded-lg shadow-md p-6 mb-8">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <Music className="w-6 h-6 text-sc" />
                <h1 className="text-2xl font-bold text-gray-800">What's Hot?</h1>
              </div>
              
              <div className="flex items-center gap-4">
                <select
                  value={sortOption}
                  onChange={(e) => {
                    setSortOption(e.target.value as SortOption);
                    setLikedTracks(sortTracks(likedTracks, e.target.value as SortOption));
                  }}
                  className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-sc focus:border-sc"
                >
                  <option value="popular">Most Popular</option>
                  <option value="newest">Newest First</option>
                  <option value="oldest">Oldest First</option>
                </select>
              </div>
            </div>

            <div className="mb-6">
              <h2 className="text-lg font-semibold text-gray-800 mb-3">Filter by Friends</h2>
              <div className="flex flex-wrap gap-2">
                {mutualFollows.map(user => (
                  <button
                    key={user.id}
                    onClick={() => toggleUserSelection(user.id)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm transition-colors ${
                      selectedUsers.has(user.id)
                        ? 'bg-sc text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    <img
                      src={user.avatar_url}
                      alt={user.username}
                      className="w-5 h-5 rounded-full"
                    />
                    {user.username}
                  </button>
                ))}
              </div>
              {selectedUsers.size > 0 && (
                <div className="mt-3 flex justify-between items-center">
                  <span className="text-sm text-gray-600">
                    {selectedUsers.size} friend{selectedUsers.size !== 1 ? 's' : ''} selected
                  </span>
                  <button
                    onClick={() => {
                      setSelectedUsers(new Set());
                      fetchLikedTracks();
                    }}
                    className="text-sm text-sc hover:text-sc-hover"
                  >
                    Clear Selection
                  </button>
                </div>
              )}
              <button
                onClick={fetchLikedTracks}
                disabled={loadingLikes}
                className="mt-4 w-full px-4 py-2 bg-sc text-white rounded-md hover:bg-sc-hover focus:outline-none focus:ring-2 focus:ring-sc focus:ring-offset-2 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loadingLikes ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Updating...
                  </>
                ) : (
                  <>
                    <ArrowUpDown className="w-5 h-5" />
                    Update Results
                  </>
                )}
              </button>
            </div>
            
            {loadingLikes ? (
              <div className="flex flex-col items-center justify-center py-12 text-gray-500">
                <Loader2 className="w-8 h-8 animate-spin mb-4" />
                <p>Fetching liked tracks from your mutual friends...</p>
              </div>
            ) : likedTracks.length > 0 ? (
              <TrackGrid tracks={likedTracks} />
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-gray-500">
                <Music className="w-12 h-12 text-gray-400 mb-4" />
                <p>No liked tracks found from your mutual friends</p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header with Login Button */}
      <div className="bg-white shadow-sm">
        <div className="max-w-4xl mx-auto px-8 py-4 flex justify-between items-center">
          <h1 className="text-xl font-bold text-gray-800">🫂 In the club, we all fam</h1>
          <button 
            onClick={handleLogin}
            className="flex items-center gap-2 px-4 py-2 bg-sc text-white rounded-md hover:bg-sc-hover focus:outline-none focus:ring-2 focus:ring-sc focus:ring-offset-2"
          >
            <LogIn className="w-5 h-5" />
            Log in
          </button>
        </div>
      </div>

      <div className="p-8">
        <div className="max-w-4xl mx-auto">
          <p className="text-lg text-gray-600 mb-8">Use this to find friends on SoundCloud</p>
          
          <div className="bg-white rounded-lg shadow-md p-6 mb-8">
            <div className="space-y-4">
              <div>
                <label htmlFor="profileUrl" className="block text-sm font-medium text-gray-700 mb-1">
                  Profile to explore
                </label>
                <input
                  id="profileUrl"
                  type="text"
                  value={profileUrl}
                  onChange={(e) => setProfileUrl(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-sc focus:border-sc"
                  placeholder="add profile url: e.g https://soundcloud.com/ham-and"
                />
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-md p-4 flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                  <div className="text-sm text-red-700">{error}</div>
                </div>
              )}

              <button
                onClick={analyzeSocialGraph}
                disabled={loading}
                className="w-full bg-sc text-white py-2 px-4 rounded-md hover:bg -sc-hover focus:outline-none focus:ring-2 focus:ring-sc focus:ring-offset-2 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Analyzing...
                  </>
                ) : (
                  <>
                    <Search className="w-5 h-5" />
                    Analyze Social Graph
                  </>
                )}
              </button>
            </div>
          </div>

          {userDetails && (
            <div className="bg-white rounded-lg shadow-md p-6 mb-8">
              <div className="flex items-center gap-4">
                <img 
                  src={userDetails.avatar_url} 
                  alt={userDetails.username}
                  className="w-16 h-16 rounded-full"
                />
                <div>
                  <h2 className="text-xl font-bold text-gray-800">{userDetails.username}</h2>
                  <div className="flex gap-4 mt-2">
                    <div className="text-sm text-gray-600">
                      <span className="font-semibold">{userDetails.followers_count}</span> followers
                    </div>
                    <div className="text-sm text-gray-600">
                      <span className="font-semibold">{userDetails.followings_count}</span> following
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {stats && (
            <CollapsibleSection 
              title="Stats" 
              icon={Users}
              isCollapsed={sectionsCollapsed.stats}
              onToggle={() => toggleSection('stats')}
            >
              <div className="grid grid-cols-2 gap-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-gray-800">{stats.followersCount}</div>
                  <div className="text-sm text-gray-600">Followers</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-gray-800">
                    {stats.followingsCount} of {stats.totalFollowings}
                  </div>
                  <div className="text-sm text-gray-600">Following</div>
                  {stats.followingsCount < stats.totalFollowings && (
                    <button
                      onClick={loadMoreFollowings}
                      className="mt-2 text-sm text-sc hover:text-sc-hover"
                    >
                      Load More
                    </button>
                  )}
                </div>
              </div>
            </CollapsibleSection>
          )}

          {mutualFollows.length > 0 ? (
            <CollapsibleSection 
              title={`Mutual Follows (${mutualFollows.length})`}
              icon={UsersRound}
              isCollapsed={sectionsCollapsed.mutualFollows}
              onToggle={() => toggleSection('mutualFollows')}
              actions={
                <button
                  onClick={fetchLikedTracks}
                  disabled={loadingLikes}
                  className="px-4 py-2 text-sm bg-sc text-white rounded-md hover:bg-sc-hover focus:outline-none focus:ring-2 focus:ring-sc focus:ring-offset-2 disabled:opacity-50 flex items-center gap-2"
                >
                  {loadingLikes ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Loading...
                    </>
                  ) : (
                    <>
                      <Heart className="w-4 h-4" />
                      What's Hot?
                    </>
                  )}
                </button>
              }
            >
              <UserGrid users={mutualFollows} title="Mutual Follows" />
            </CollapsibleSection>
          ) : (
            <EmptySection title="Mutual Follows" icon={UsersRound} />
          )}

          {mutualFollowers.length > 0 ? (
            <CollapsibleSection 
              title={`Followers You Don't Follow Back (${mutualFollowers.length})`}
              icon={Users}
              isCollapsed={sectionsCollapsed.nonMutuals}
              onToggle={() => toggleSection('nonMutuals')}
            >
              <UserGrid users={mutualFollowers} title="Followers You Don't Follow Back" />
            </CollapsibleSection>
          ) : (
            <EmptySection title="Followers You Don't Follow Back" icon={Users} />
          )}

          <CollapsibleSection 
            title="Suggested Follows"
            icon={UserPlus}
            isCollapsed={sectionsCollapsed.suggestions}
            onToggle={() => toggleSection('suggestions')}
          >
            <div>
              {mutualFollows.length > 0 && !analyzingSuggestions && !suggestedUsers.length && (
                <button
                  onClick={findSuggestedFollows}
                  className="mb-4 px-4 py-2 text-sm bg-sc text-white rounded-md hover:bg-sc-hover focus:outline-none focus:ring-2 focus:ring-sc focus:ring-offset-2"
                >
                  Find Suggestions
                </button>
              )}
              
              {analyzingSuggestions ? (
                <div className="flex flex-col items-center justify-center py-12 text-gray-500">
                  <Loader2 className="w-8 h-8 animate-spin mb-4" />
                  <p>Analyzing {suggestionProgress.current} of {suggestionProgress.total} mutual follows...</p>
                </div>
              ) : suggestedUsers.length > 0 ? (
                <UserGrid users={suggestedUsers} title="Suggested Follows" showMutuals={true} />
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-gray-500">
                  <UserPlus className="w-12 h-12 text-gray-400 mb-4" />
                  <p>Click 'Find Suggestions' to discover new accounts</p>
                </div>
              )}
            </div>
          </CollapsibleSection>
        </div>
      </div>
    </div>
  );
}

export default App;