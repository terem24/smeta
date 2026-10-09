<?php
/**
 * Отдача прайса дистрибьютора браузеру: dist_price_get.php?key=kit-service
 *
 * Файл dist_prices_data/<ключ>.json кладёт dist_price_save.php, когда админ
 * загружает новый прайс. Браузер монтажника дистрибьютора забирает его и
 * накладывает цены на каталог (app.loadRemoteDistPrices).
 *
 * Открытый эндпоинт: в файле только артикулы и цены, те же, что раньше лежали в
 * dist_prices.js и отдавались любому открывшему сайт. Автора загрузки здесь нет —
 * он только в журнале базы.
 *
 * Сжатие и ETag, как у price_index.php: прайс ~150 КБ, а качают его при каждом
 * входе, поэтому повторный запрос должен кончаться ответом 304 без тела.
 * Нет файла (прайс ещё не загружали) — 404, и калькулятор берёт прайс, зашитый
 * в dist_prices.js.
 */

header('Access-Control-Allow-Origin: *');
header('Content-Type: application/json; charset=utf-8');

$key = isset($_GET['key']) ? (string)$_GET['key'] : '';
if (!preg_match('/^[a-z0-9][a-z0-9-]{1,39}$/', $key)) {
    http_response_code(400);
    echo json_encode(['error' => 'bad key']);
    exit;
}

$file = __DIR__ . '/dist_prices_data/' . $key . '.json';
if (!is_file($file)) {
    http_response_code(404);
    echo json_encode(['error' => 'not uploaded']);
    exit;
}

$mtime = filemtime($file);
$etag = '"' . md5($mtime . filesize($file)) . '"';
header('ETag: ' . $etag);
// Не сутки, как у индекса: загруженный прайс должен доезжать до монтажников за
// минуты, а не на следующий день. ETag всё равно сводит повторный запрос к 304.
header('Cache-Control: public, max-age=300, must-revalidate');
header('Last-Modified: ' . gmdate('D, d M Y H:i:s', $mtime) . ' GMT');

if (trim($_SERVER['HTTP_IF_NONE_MATCH'] ?? '') === $etag) {
    http_response_code(304);
    exit;
}

if (!ob_start('ob_gzhandler')) ob_start();
readfile($file);
