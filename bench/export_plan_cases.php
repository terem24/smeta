<?php
/**
 * Выгрузка подложек планов для регрессии распознавания. Запускается на сервере,
 * где лежит папка plans/ (см. plans.php). Копирует только картинки этажей и
 * манифест; owner.json (email загрузившего) не копируется никогда.
 *
 * Запуск:  php bench/export_plan_cases.php /путь/plans /путь/вывод
 *
 * Результат: вывод/<ключ проекта>/<этаж>-<хеш>.jpg и вывод/manifest.json
 * с ключом, этажем, размером и датой — без персональных полей.
 */
if (PHP_SAPI !== 'cli') { http_response_code(403); exit("только из командной строки\n"); }
$plansDir = rtrim($argv[1] ?? '', '/');
$outDir = rtrim($argv[2] ?? '', '/');
if (!is_dir($plansDir) || $outDir === '') { fwrite(STDERR, "укажите папку plans и папку вывода\n"); exit(2); }
if (!is_dir($outDir) && !mkdir($outDir, 0750, true)) { fwrite(STDERR, "не создать $outDir\n"); exit(2); }

$manifest = [];
foreach (scandir($plansDir) ?: [] as $key) {
    if (!preg_match('/^[a-f0-9]{32}$/', $key) || !is_dir("$plansDir/$key")) continue;
    $dst = "$outDir/$key";
    foreach (scandir("$plansDir/$key") ?: [] as $f) {
        // только подложки этажей: «<этаж>-<хеш>.jpg»; owner.json и прочее пропускаем
        if (!preg_match('/^(\d+)-[A-Za-z0-9_.-]+\.(jpe?g|png)$/i', $f, $m)) continue;
        if (!is_dir($dst)) mkdir($dst, 0750, true);
        if (!copy("$plansDir/$key/$f", "$dst/$f")) continue;
        $manifest[] = ['key' => $key, 'floor' => (int)$m[1], 'file' => "$key/$f",
            'bytes' => filesize("$dst/$f"), 'mtime' => date('c', filemtime("$dst/$f"))];
    }
}
file_put_contents("$outDir/manifest.json", json_encode($manifest, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
echo count($manifest) . " подложек выгружено\n";
