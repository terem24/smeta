<?php
/**
 * Город и страна по IP посетителя — для самого сайта.
 *
 * Раньше браузер сам ходил в ipapi.co и ipinfo.io: это отдавало IP каждого посетителя
 * иностранным сервисам, а из РФ они отвечали по 10–30 секунд (вход задерживался, часть
 * регистраций терялась — см. stampLoginGeo в app.js). Теперь браузер спрашивает этот
 * файл, а он спрашивает российский сервис Sypex Geo (api.sypexgeo.net): данные не уходят
 * за границу, ответ приходит за доли секунды.
 *
 * Ответ повторяет поля ipapi.co, которые читает app.js: ip, city (латиницей — по ней
 * app.js сверяет регион), region, country_code, country_name, latitude, longitude.
 *
 * IP берём из REMOTE_ADDR, а не из X-Forwarded-For: второй заголовок присылает сам клиент.
 * Ответы на день кладём во временную папку, чтобы не ходить в Sypex на каждое открытие
 * страницы тем же человеком. Нет ответа от Sypex — отдаём один IP, остальное пустое:
 * сайт это переживает (город «Не определен»).
 *
 * Лежит на proxy.heatcalc.ru рядом с остальными прокси; кладётся руками, как они.
 */

error_reporting(0);
ini_set('display_errors', 0);

$ALLOWED_ORIGINS = ['https://heatcalc.ru', 'https://www.heatcalc.ru', 'https://localhost', 'http://localhost'];
$origin = isset($_SERVER['HTTP_ORIGIN']) ? $_SERVER['HTTP_ORIGIN'] : '';
if (in_array($origin, $ALLOWED_ORIGINS, true)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
}
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Content-Type: application/json; charset=UTF-8');
header('Cache-Control: private, max-age=3600');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

$ip = isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : '';
$out = [
    'ip' => $ip, 'city' => '', 'region' => '',
    'country_code' => '', 'country_name' => '',
    'latitude' => null, 'longitude' => null,
];
if (!filter_var($ip, FILTER_VALIDATE_IP)) {
    echo json_encode($out);
    exit;
}

$cacheFile = sys_get_temp_dir() . '/hc_geo_' . md5($ip);
if (is_file($cacheFile) && (time() - filemtime($cacheFile)) < 86400) {
    $cached = json_decode((string)@file_get_contents($cacheFile), true);
    if (is_array($cached)) {
        echo json_encode($cached, JSON_UNESCAPED_UNICODE);
        exit;
    }
}

$ch = curl_init('https://api.sypexgeo.net/json/' . rawurlencode($ip));
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_TIMEOUT, 4);
curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 3);
$raw = curl_exec($ch);
$code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

$j = ($code === 200 && $raw) ? json_decode($raw, true) : null;
if (is_array($j)) {
    $city = isset($j['city']) && is_array($j['city']) ? $j['city'] : [];
    $region = isset($j['region']) && is_array($j['region']) ? $j['region'] : [];
    $country = isset($j['country']) && is_array($j['country']) ? $j['country'] : [];
    $out['city'] = isset($city['name_en']) ? (string)$city['name_en'] : '';
    $out['region'] = isset($region['name_en']) ? (string)$region['name_en'] : '';
    $out['country_code'] = isset($country['iso']) ? (string)$country['iso'] : '';
    $out['country_name'] = isset($country['name_en']) ? (string)$country['name_en'] : '';
    $lat = isset($city['lat']) && $city['lat'] !== null ? $city['lat'] : (isset($country['lat']) ? $country['lat'] : null);
    $lon = isset($city['lon']) && $city['lon'] !== null ? $city['lon'] : (isset($country['lon']) ? $country['lon'] : null);
    $out['latitude'] = $lat !== null ? (float)$lat : null;
    $out['longitude'] = $lon !== null ? (float)$lon : null;
    @file_put_contents($cacheFile, json_encode($out, JSON_UNESCAPED_UNICODE));
}

echo json_encode($out, JSON_UNESCAPED_UNICODE);
