<?php
/**
 * Приём заявки на монтаж со страницы /montazh-otopleniya-spb/.
 *
 * Пилот: заявка приходит владельцу в Телеграм, он вручную передаёт её одному из
 * знакомых монтажников. Базы, биржи и оплаты пока нет — сначала проверяем, есть ли
 * спрос (см. план от 25.09.2026).
 *
 * Почему здесь, а не из браузера. Уведомления сайта шлются в Телеграм прямо из app.js,
 * с токеном бота в открытом коде публичного репозитория. Для заявок так нельзя: в них
 * телефон и адрес заказчика. Токен берётся из tg_notify_secret.php — того же файла, что
 * и у уведомлений сайта (tg_notify.php). Свой lead_secret.php рядом нужен, только если
 * для заявок заведут отдельного бота: он в .gitignore и кладётся на Beget руками:
 *
 *     <?php return ['bot_token' => '…', 'chat_id' => '…'];
 *
 * Журнал заявок — leads_log.php в этой же папке. Первая строка файла — «<?php exit; ?>»,
 * поэтому по адресу из браузера он отдаёт пустоту, хотя лежит в открытой папке.
 * Смотреть его — через файловый менеджер Beget.
 *
 * Защита от мусора: скрытое поле-ловушка (люди его не видят и не заполняют), не больше
 * пяти заявок в час с одного адреса, согласие на передачу данных обязательно — без него
 * заявку не принимаем вовсе: без согласия передать её мастеру было бы нарушением закона.
 */

error_reporting(0);
ini_set('display_errors', 0);

$ALLOWED_ORIGINS = ['https://heatcalc.ru', 'https://www.heatcalc.ru'];
$origin = isset($_SERVER['HTTP_ORIGIN']) ? $_SERVER['HTTP_ORIGIN'] : '';
if (in_array($origin, $ALLOWED_ORIGINS, true)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
}
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Content-Type: application/json; charset=UTF-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['ok' => false, 'error' => 'method']);
    exit;
}

function reply($code, $data) {
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function clean($v, $max) {
    $v = is_string($v) ? $v : '';
    $v = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $v);
    $v = trim(preg_replace('/[ \t]+/u', ' ', $v));
    return mb_substr($v, 0, $max, 'UTF-8');
}

$in = json_decode(file_get_contents('php://input'), true);
if (!is_array($in)) {
    reply(400, ['ok' => false, 'error' => 'bad_request']);
}

// Ловушка: поле спрятано от людей. Боту отвечаем «принято», чтобы он не подбирал обход.
if (!empty($in['website'])) {
    reply(200, ['ok' => true]);
}

$WORKS = [
    'heating'  => 'Отопление (радиаторы)',
    'ufh'      => 'Тёплый пол',
    'boiler'   => 'Котельная, котёл',
    'water'    => 'Водоснабжение (бурение не делаем)',
    'sewer'    => 'Канализация',
    'other'    => 'Другое',
];

$works = [];
if (isset($in['works']) && is_array($in['works'])) {
    foreach ($in['works'] as $w) {
        if (is_string($w) && isset($WORKS[$w])) $works[$w] = $WORKS[$w];
    }
}
$name     = clean(isset($in['name']) ? $in['name'] : '', 80);
$phoneRaw = clean(isset($in['phone']) ? $in['phone'] : '', 40);
$place    = clean(isset($in['place']) ? $in['place'] : '', 120);
$area     = clean(isset($in['area']) ? $in['area'] : '', 10);
$when     = clean(isset($in['when']) ? $in['when'] : '', 80);
$comment  = clean(isset($in['comment']) ? $in['comment'] : '', 1000);
$page     = clean(isset($in['page']) ? $in['page'] : '', 200);
// Метка источника: слаг статьи, с которой человек пришёл по ссылке ?src=.
// По ней потом считается, какие статьи приносят заявки. Пусто — значит
// человек попал на форму напрямую или из поиска.
$src      = clean(isset($in['src']) ? $in['src'] : '', 64);
$consent  = !empty($in['consent']);

// Телефон — только российский: 11 цифр с 7 или 8 впереди, либо 10 цифр.
$digits = preg_replace('/\D+/', '', $phoneRaw);
if (strlen($digits) === 11 && ($digits[0] === '7' || $digits[0] === '8')) {
    $digits = '7' . substr($digits, 1);
} elseif (strlen($digits) === 10) {
    $digits = '7' . $digits;
} else {
    $digits = '';
}

$errors = [];
if ($name === '') $errors[] = 'name';
if ($digits === '') $errors[] = 'phone';
if ($place === '') $errors[] = 'place';
if (!$works) $errors[] = 'works';
if (!$consent) $errors[] = 'consent';
if ($area !== '' && !preg_match('/^\d{1,4}$/', $area)) $errors[] = 'area';
if ($errors) {
    reply(422, ['ok' => false, 'error' => 'fields', 'fields' => $errors]);
}

// Не больше пяти заявок в час с одного адреса.
$ip = isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : '0';
$rlFile = sys_get_temp_dir() . '/hc_lead_' . md5($ip . '|heatcalc');
$now = time();
$hits = [];
if (is_file($rlFile)) {
    $hits = array_filter(explode(',', (string)@file_get_contents($rlFile)), function ($t) use ($now) {
        return is_numeric($t) && ($now - (int)$t) < 3600;
    });
}
if (count($hits) >= 5) {
    reply(429, ['ok' => false, 'error' => 'rate']);
}
$hits[] = $now;
@file_put_contents($rlFile, implode(',', $hits), LOCK_EX);

$phoneFmt = '+7 (' . substr($digits, 1, 3) . ') ' . substr($digits, 4, 3) . '-' . substr($digits, 7, 2) . '-' . substr($digits, 9, 2);
$id = date('ymd-His') . '-' . substr(md5($digits . $now), 0, 4);

$record = [
    'id'      => $id,
    'at'      => date('c'),
    'name'    => $name,
    'phone'   => $phoneFmt,
    'place'   => $place,
    'area'    => $area,
    'works'   => array_values($works),
    'when'    => $when,
    'comment' => $comment,
    'page'    => $page,
    'src'     => $src,
    'consent' => true,
];

// Журнал — прежде уведомления: если Телеграм не ответит, заявка всё равно не потеряется.
$logFile = __DIR__ . '/leads_log.php';
if (!is_file($logFile)) {
    @file_put_contents($logFile, "<?php exit; ?>\n", LOCK_EX);
}
$logged = @file_put_contents($logFile, json_encode($record, JSON_UNESCAPED_UNICODE) . "\n", FILE_APPEND | LOCK_EX) !== false;

// Токен берём из того же файла, что и уведомления сайта (tg_notify_secret.php,
// положен 25.09.2026 вместе с tg_notify.php). Свой lead_secret.php нужен только
// если для заявок захотят отдельного бота — тогда он и будет главнее. Держать
// один токен в двух файлах нельзя: при перевыпуске один из них протухнет молча.
$sent = false;
$secret = null;
// Имя переменной цикла — не $name и не $file: в $name лежит имя заказчика, и цикл
// затирал его именем файла секрета. В тестовой заявке 25.09.2026 вместо имени
// пришло «tg_notify_secret.php».
foreach (['lead_secret.php', 'tg_notify_secret.php'] as $secretName) {
    $secretPath = __DIR__ . '/' . $secretName;
    if (is_file($secretPath)) {
        $secret = include $secretPath;
        break;
    }
}
if (is_array($secret) && !empty($secret['bot_token']) && !empty($secret['chat_id'])) {
    $text = "🔧 ЗАЯВКА НА МОНТАЖ № {$id}\n"
        . "Что: " . implode(', ', $works) . "\n"
        . "Где: {$place}\n"
        . ($area !== '' ? "Площадь: {$area} м²\n" : '')
        . "Имя: {$name}\n"
        . "Телефон: {$phoneFmt}\n"
        . ($when !== '' ? "Когда звонить: {$when}\n" : '')
        . ($comment !== '' ? "Комментарий: {$comment}\n" : '')
        . "Согласие на передачу мастеру: да\n"
        . ($src !== '' ? "Источник: {$src}
" : '')
        . ($page !== '' ? "Страница: {$page}" : '');

    $ch = curl_init('https://api.telegram.org/bot' . $secret['bot_token'] . '/sendMessage');
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode(['chat_id' => $secret['chat_id'], 'text' => $text], JSON_UNESCAPED_UNICODE));
    curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 10);
    $resp = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    $sent = ($code === 200);
}

// Заявка считается принятой, если она хотя бы в одном месте: журнал или Телеграм.
if (!$logged && !$sent) {
    reply(502, ['ok' => false, 'error' => 'store']);
}
reply(200, ['ok' => true, 'id' => $id]);
