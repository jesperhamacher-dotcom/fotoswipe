import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, Image, Animated, PanResponder, Dimensions, TouchableOpacity,
  StyleSheet, ActivityIndicator, Alert, SafeAreaView, StatusBar,
} from 'react-native';
import * as MediaLibrary from 'expo-media-library';
import AsyncStorage from '@react-native-async-storage/async-storage';

const { width: W, height: H } = Dimensions.get('window');
const THRESHOLD = W * 0.25;
const PAGE = 60;
const KEPT_KEY = 'fotoswipe_kept_ids';

export default function App() {
  const [permission, setPermission] = useState(null);
  const [assets, setAssets] = useState([]);
  const [index, setIndex] = useState(0);
  const [toDelete, setToDelete] = useState([]);   // Assets, die gelöscht werden sollen
  const [history, setHistory] = useState([]);     // für "Rückgängig"
  const [loading, setLoading] = useState(true);

  const cursor = useRef(null);
  const hasNext = useRef(true);
  const loadingMore = useRef(false);
  const keptIds = useRef(new Set());
  const pos = useRef(new Animated.ValueXY()).current;
  const decideRef = useRef(() => {});

  // ---------- Laden ----------
  const loadMore = useCallback(async () => {
    if (!hasNext.current || loadingMore.current) return;
    loadingMore.current = true;
    try {
      const page = await MediaLibrary.getAssetsAsync({
        first: PAGE,
        after: cursor.current ?? undefined,
        mediaType: MediaLibrary.MediaType.photo,
        sortBy: [[MediaLibrary.SortBy.creationTime, false]],
      });
      cursor.current = page.endCursor;
      hasNext.current = page.hasNextPage;
      const fresh = page.assets.filter(a => !keptIds.current.has(a.id));
      setAssets(prev => [...prev, ...fresh]);
      // Falls eine ganze Seite schon behalten wurde: direkt weiterladen
      if (fresh.length === 0 && page.hasNextPage) {
        loadingMore.current = false;
        return loadMore();
      }
    } catch (e) {
      Alert.alert('Fehler beim Laden', String(e?.message ?? e));
    }
    loadingMore.current = false;
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(KEPT_KEY);
        if (saved) keptIds.current = new Set(JSON.parse(saved));
      } catch {}
      const res = await MediaLibrary.requestPermissionsAsync(false, ['photo']);
      setPermission(res);
      if (res.granted) await loadMore();
      setLoading(false);
    })();
  }, [loadMore]);

  // Nachladen, wenn das Ende näher kommt
  useEffect(() => {
    if (assets.length - index < 15) loadMore();
  }, [index, assets.length, loadMore]);

  const saveKept = () =>
    AsyncStorage.setItem(KEPT_KEY, JSON.stringify([...keptIds.current])).catch(() => {});

  // ---------- Entscheidung ----------
  const decide = (action) => {
    const asset = assets[index];
    if (!asset) return;
    const toX = action === 'keep' ? -W * 1.5 : W * 1.5;
    Animated.timing(pos, { toValue: { x: toX, y: 0 }, duration: 200, useNativeDriver: false })
      .start(() => {
        if (action === 'keep') {
          keptIds.current.add(asset.id);
          saveKept();
        } else {
          setToDelete(prev => [...prev, asset]);
        }
        setHistory(prev => [...prev, { action, asset }]);
        setIndex(i => i + 1);
        pos.setValue({ x: 0, y: 0 });
      });
  };
  decideRef.current = decide;

  const undo = () => {
    const last = history[history.length - 1];
    if (!last) return;
    if (last.action === 'keep') {
      keptIds.current.delete(last.asset.id);
      saveKept();
    } else {
      setToDelete(prev => prev.filter(a => a.id !== last.asset.id));
    }
    setHistory(prev => prev.slice(0, -1));
    setIndex(i => Math.max(0, i - 1));
  };

  const deleteNow = async () => {
    if (toDelete.length === 0) return;
    try {
      // Das System zeigt hier eine eigene Bestätigung an
      const ok = await MediaLibrary.deleteAssetsAsync(toDelete.map(a => a.id));
      if (ok !== false) {
        Alert.alert('Erledigt', `${toDelete.length} Foto(s) gelöscht.`);
        const ids = new Set(toDelete.map(a => a.id));
        setHistory(prev => prev.filter(h => !(h.action === 'delete' && ids.has(h.asset.id))));
        setToDelete([]);
      }
    } catch (e) {
      Alert.alert('Löschen abgebrochen', String(e?.message ?? e));
    }
  };

  // ---------- Wischgeste ----------
  const pan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 10,
    onPanResponderMove: (_, g) => pos.setValue({ x: g.dx, y: g.dy * 0.2 }),
    onPanResponderRelease: (_, g) => {
      if (g.dx < -THRESHOLD) decideRef.current('keep');
      else if (g.dx > THRESHOLD) decideRef.current('delete');
      else Animated.spring(pos, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start();
    },
  })).current;

  const rotate = pos.x.interpolate({ inputRange: [-W, 0, W], outputRange: ['-12deg', '0deg', '12deg'] });
  const keepOpacity = pos.x.interpolate({ inputRange: [-THRESHOLD, 0], outputRange: [1, 0], extrapolate: 'clamp' });
  const delOpacity = pos.x.interpolate({ inputRange: [0, THRESHOLD], outputRange: [0, 1], extrapolate: 'clamp' });

  // ---------- Ansicht ----------
  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color="#fff" /></View>;
  }
  if (!permission?.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.msg}>Ohne Zugriff auf deine Fotos geht es leider nicht.</Text>
        <TouchableOpacity style={styles.btn} onPress={async () => {
          const res = await MediaLibrary.requestPermissionsAsync(false, ['photo']);
          setPermission(res);
          if (res.granted) loadMore();
        }}>
          <Text style={styles.btnText}>Zugriff erlauben</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const current = assets[index];
  const next = assets[index + 1];

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="light-content" />
      <View style={styles.header}>
        <Text style={styles.headerText}>
          {permission.accessPrivileges === 'limited' ? 'Nur ausgewählte Fotos · ' : ''}
          Behalten ← · → Löschen
        </Text>
      </View>

      <View style={styles.stage}>
        {next && <Image source={{ uri: next.uri }} style={[styles.card, styles.under]} resizeMode="contain" />}
        {current ? (
          <Animated.View
            {...pan.panHandlers}
            style={[styles.card, { transform: [{ translateX: pos.x }, { translateY: pos.y }, { rotate }] }]}
          >
            <Image source={{ uri: current.uri }} style={styles.img} resizeMode="contain" />
            <Animated.Text style={[styles.badge, styles.keepBadge, { opacity: keepOpacity }]}>BEHALTEN</Animated.Text>
            <Animated.Text style={[styles.badge, styles.delBadge, { opacity: delOpacity }]}>LÖSCHEN</Animated.Text>
          </Animated.View>
        ) : (
          <Text style={styles.msg}>
            {hasNext.current ? 'Lade weitere Fotos …' : 'Fertig! Keine weiteren Fotos.'}
          </Text>
        )}
      </View>

      <View style={styles.footer}>
        <TouchableOpacity style={[styles.btn, styles.small]} onPress={undo} disabled={!history.length}>
          <Text style={styles.btnText}>↶ Zurück</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.btn, styles.danger, !toDelete.length && styles.disabled]}
          onPress={deleteNow}
          disabled={!toDelete.length}
        >
          <Text style={styles.btnText}>{toDelete.length} Foto(s) jetzt löschen</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#111' },
  center: { flex: 1, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center', padding: 24 },
  header: { paddingVertical: 12, alignItems: 'center' },
  headerText: { color: '#aaa', fontSize: 15 },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: { position: 'absolute', width: W - 24, height: H * 0.68, borderRadius: 16, backgroundColor: '#000', overflow: 'hidden' },
  under: { transform: [{ scale: 0.95 }], opacity: 0.6 },
  img: { width: '100%', height: '100%' },
  badge: { position: 'absolute', top: 30, fontSize: 30, fontWeight: '800', borderWidth: 4, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 4 },
  keepBadge: { right: 20, color: '#2ecc71', borderColor: '#2ecc71', transform: [{ rotate: '12deg' }] },
  delBadge: { left: 20, color: '#e74c3c', borderColor: '#e74c3c', transform: [{ rotate: '-12deg' }] },
  footer: { flexDirection: 'row', gap: 12, padding: 16 },
  btn: { flex: 1, backgroundColor: '#333', paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  small: { flex: 0.5 },
  danger: { backgroundColor: '#c0392b' },
  disabled: { opacity: 0.4 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  msg: { color: '#ccc', fontSize: 17, textAlign: 'center', marginBottom: 16 },
});
