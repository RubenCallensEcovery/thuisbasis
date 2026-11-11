package be.callens.thuisbasis;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.webkit.WebView;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import java.util.ArrayList;
import java.util.Locale;
import org.json.JSONObject;

/**
 * Spraak voor "Praat met Jonah" in de app: Androids eigen spraakherkenning en voorleesstem.
 * De pagina gebruikt ze via dezelfde vorm als in de browser (SpeechRecognition / speechSynthesis), zie thuis-app.js.
 */
final class Voice {
    private Voice() {}

    static final int REQ_MIC = 8;
    private static SpeechRecognizer rec;
    private static int recId = 0;
    private static TextToSpeech tts;
    private static boolean ttsReady = false;
    private static String[] pending; // {id, lang, interim} wachtend op microfoontoestemming

    private static void js(WebView w, String code) {
        if (w != null) w.post(() -> w.evaluateJavascript(code, null));
    }

    private static void emit(WebView w, int id, String type, String data) {
        js(w, "window.__thuisSR&&window.__thuisSR(" + id + "," + JSONObject.quote(type) + "," + (data == null ? "null" : data) + ")");
    }

    /* ---------- luisteren ---------- */
    static void start(Activity a, WebView w, int id, String lang, boolean interim) {
        a.runOnUiThread(() -> {
            if (ContextCompat.checkSelfPermission(a, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                pending = new String[] { String.valueOf(id), lang, String.valueOf(interim) };
                ActivityCompat.requestPermissions(a, new String[] { Manifest.permission.RECORD_AUDIO }, REQ_MIC);
                return;
            }
            listen(a, w, id, lang, interim);
        });
    }

    /** antwoord op de vraag om de microfoon */
    static void onPermission(Activity a, WebView w, boolean granted) {
        String[] p = pending;
        pending = null;
        if (p == null) return;
        int id = Integer.parseInt(p[0]);
        if (granted) listen(a, w, id, p[1], Boolean.parseBoolean(p[2]));
        else { emit(w, id, "error", "\"not-allowed\""); emit(w, id, "end", null); }
    }

    private static void listen(Activity a, WebView w, int id, String lang, boolean interim) {
        if (!SpeechRecognizer.isRecognitionAvailable(a)) {
            emit(w, id, "error", "\"service-not-allowed\"");
            emit(w, id, "end", null);
            return;
        }
        abort(a);
        recId = id;
        rec = SpeechRecognizer.createSpeechRecognizer(a);
        rec.setRecognitionListener(new RecognitionListener() {
            boolean ended = false;
            void end() { if (!ended) { ended = true; emit(w, id, "end", null); } }
            @Override public void onReadyForSpeech(Bundle b) { emit(w, id, "start", null); }
            @Override public void onBeginningOfSpeech() {}
            @Override public void onRmsChanged(float v) {}
            @Override public void onBufferReceived(byte[] b) {}
            @Override public void onEndOfSpeech() {}
            @Override public void onError(int e) {
                String code = e == SpeechRecognizer.ERROR_NO_MATCH || e == SpeechRecognizer.ERROR_SPEECH_TIMEOUT ? "no-speech"
                    : e == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS ? "not-allowed"
                    : e == SpeechRecognizer.ERROR_CLIENT ? "aborted"
                    : e == SpeechRecognizer.ERROR_NETWORK || e == SpeechRecognizer.ERROR_NETWORK_TIMEOUT ? "network" : "audio-capture";
                emit(w, id, "error", JSONObject.quote(code));
                end();
            }
            @Override public void onResults(Bundle b) {
                ArrayList<String> r = b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                String t = r != null && !r.isEmpty() ? r.get(0) : "";
                emit(w, id, "result", "{\"text\":" + JSONObject.quote(t) + ",\"final\":true}");
                end();
            }
            @Override public void onPartialResults(Bundle b) {
                ArrayList<String> r = b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                if (r != null && !r.isEmpty() && !r.get(0).isEmpty())
                    emit(w, id, "result", "{\"text\":" + JSONObject.quote(r.get(0)) + ",\"final\":false}");
            }
            @Override public void onEvent(int t, Bundle b) {}
        });
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang == null || lang.isEmpty() ? "nl-BE" : lang)
            .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, interim)
            .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        rec.startListening(i);
    }

    static void stop(Activity a) {
        a.runOnUiThread(() -> { if (rec != null) rec.stopListening(); });
    }

    static void abort(Activity a) {
        a.runOnUiThread(() -> {
            if (rec != null) { try { rec.cancel(); rec.destroy(); } catch (Exception ignored) {} rec = null; }
        });
    }

    /* ---------- voorlezen ---------- */
    static void speak(Activity a, WebView w, int id, String text, String lang, float rate) {
        a.runOnUiThread(() -> {
            if (tts == null) {
                tts = new TextToSpeech(a.getApplicationContext(), s -> {
                    ttsReady = s == TextToSpeech.SUCCESS;
                    if (ttsReady) say(w, id, text, lang, rate);
                    else js(w, "window.__thuisTTS&&window.__thuisTTS(" + id + ",'error')");
                });
                return;
            }
            if (ttsReady) say(w, id, text, lang, rate);
        });
    }

    private static void say(WebView w, int id, String text, String lang, float rate) {
        Locale l = lang != null && lang.toLowerCase().startsWith("nl") ? new Locale("nl", "BE") : Locale.forLanguageTag(lang == null ? "nl-BE" : lang);
        if (tts.isLanguageAvailable(l) < TextToSpeech.LANG_AVAILABLE) l = new Locale("nl");
        tts.setLanguage(l);
        tts.setSpeechRate(rate > 0 ? rate : 1f);
        tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
            @Override public void onStart(String u) {}
            @Override public void onDone(String u) { js(w, "window.__thuisTTS&&window.__thuisTTS(" + u + ",'end')"); }
            @Override public void onError(String u) { js(w, "window.__thuisTTS&&window.__thuisTTS(" + u + ",'error')"); }
            @Override public void onStop(String u, boolean interrupted) { js(w, "window.__thuisTTS&&window.__thuisTTS(" + u + ",'error')"); }
        });
        tts.speak(text == null ? "" : text, TextToSpeech.QUEUE_FLUSH, null, String.valueOf(id));
    }

    static void silence(Activity a) {
        a.runOnUiThread(() -> { if (tts != null) tts.stop(); });
    }
}
