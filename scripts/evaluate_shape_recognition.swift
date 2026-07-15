import CoreGraphics
import Foundation

private struct ShapeSamplePoint: Decodable {
    var x: Double
    var y: Double

    var cgPoint: CGPoint {
        CGPoint(x: x, y: y)
    }
}

private struct ShapeSampleScore: Decodable {
    var kind: String
    var score: Double
}

private struct ShapeSampleRecord: Decodable {
    var id: String
    var source: String?
    var expectedKind: String?
    var selectedKind: String?
    var reason: String?
    var rawPoints: [ShapeSamplePoint]
}

private struct Options {
    var corpusPath = "docs/notes/shape-recognition-quickdraw-samples.jsonl"
    var minAccuracy = 0.70
    var maxWrong = 16
    var showMismatches = false
}

private struct Stats {
    var total = 0
    var correct = 0
    var none = 0
    var wrong = 0
    var matrix: [String: [String: Int]] = [:]

    var accuracy: Double {
        total == 0 ? 0 : Double(correct) / Double(total)
    }
}

private struct Mismatch {
    var id: String
    var expected: String
    var selected: String
    var debug: String
}

@main
private enum ShapeRecognitionEvaluator {
    static func main() throws {
        let options = try parseOptions()
        let url = URL(fileURLWithPath: options.corpusPath)
        let text = try String(contentsOf: url, encoding: .utf8)
        let decoder = JSONDecoder()
        let recognizer = PDFShapeRecognizer()
        var stats = Stats()
        var mismatches: [Mismatch] = []

        for line in text.split(whereSeparator: \.isNewline) {
            let sample = try decoder.decode(ShapeSampleRecord.self, from: Data(line.utf8))
            guard let expected = sample.expectedKind, !expected.isEmpty else { continue }
            let points = sample.rawPoints.map(\.cgPoint)
            let attempt = recognizer.recognizeAttempt(points: points)
            let selected = attempt?.fit?.kind ?? "none"

            stats.total += 1
            stats.matrix[expected, default: [:]][selected, default: 0] += 1
            if selected == expected {
                stats.correct += 1
            } else if selected == "none" {
                stats.none += 1
            } else {
                stats.wrong += 1
            }

            if selected != expected {
                mismatches.append(Mismatch(
                    id: sample.id,
                    expected: expected,
                    selected: selected,
                    debug: attempt?.debug.consoleDetails ?? "no recognizer attempt"
                ))
            }
        }

        printSummary(stats, corpusPath: options.corpusPath)
        if options.showMismatches {
            printMismatches(mismatches)
        }

        guard stats.total > 0 else {
            fputs("No labeled samples found in \(options.corpusPath)\n", stderr)
            Foundation.exit(2)
        }
        if stats.accuracy < options.minAccuracy || stats.wrong > options.maxWrong {
            fputs("Shape recognition gate failed: accuracy \(format(stats.accuracy)) < \(format(options.minAccuracy)) or wrong \(stats.wrong) > \(options.maxWrong)\n", stderr)
            Foundation.exit(1)
        }
    }

    private static func parseOptions() throws -> Options {
        var options = Options()
        var args = Array(CommandLine.arguments.dropFirst())
        while !args.isEmpty {
            let arg = args.removeFirst()
            switch arg {
            case "--corpus":
                options.corpusPath = try takeValue(arg, from: &args)
            case "--min-accuracy":
                options.minAccuracy = Double(try takeValue(arg, from: &args)) ?? options.minAccuracy
            case "--max-wrong":
                options.maxWrong = Int(try takeValue(arg, from: &args)) ?? options.maxWrong
            case "--show-mismatches":
                options.showMismatches = true
            case "--help", "-h":
                printHelp()
                Foundation.exit(0)
            default:
                throw EvaluationError.invalidArgument(arg)
            }
        }
        return options
    }

    private static func takeValue(_ option: String, from args: inout [String]) throws -> String {
        guard !args.isEmpty else { throw EvaluationError.missingValue(option) }
        return args.removeFirst()
    }

    private static func printSummary(_ stats: Stats, corpusPath: String) {
        print("corpus=\(corpusPath)")
        print("total=\(stats.total) correct=\(stats.correct) none=\(stats.none) wrong=\(stats.wrong) accuracy=\(format(stats.accuracy))")
        for expected in stats.matrix.keys.sorted() {
            let row = stats.matrix[expected, default: [:]]
                .sorted { $0.key < $1.key }
                .map { "\($0.key)=\($0.value)" }
                .joined(separator: " ")
            print("\(expected): \(row)")
        }
    }

    private static func printMismatches(_ mismatches: [Mismatch]) {
        guard !mismatches.isEmpty else { return }
        print("mismatches:")
        for mismatch in mismatches {
            print("\(mismatch.id) expected=\(mismatch.expected) selected=\(mismatch.selected) \(mismatch.debug)")
        }
    }

    private static func printHelp() {
        print("""
        Usage:
          evaluate_shape_recognition --corpus docs/notes/shape-recognition-quickdraw-samples.jsonl

        Options:
          --corpus PATH          JSONL corpus with expectedKind and rawPoints
          --min-accuracy VALUE   fail when accuracy is below VALUE (default: 0.70)
          --max-wrong VALUE      fail when wrong non-none snaps exceed VALUE (default: 16)
          --show-mismatches      print every mismatch with recognizer debug scores
        """)
    }

    private static func format(_ value: Double) -> String {
        String(format: "%.4f", value)
    }
}

private enum EvaluationError: Error, CustomStringConvertible {
    case invalidArgument(String)
    case missingValue(String)

    var description: String {
        switch self {
        case .invalidArgument(let arg):
            return "Invalid argument: \(arg)"
        case .missingValue(let option):
            return "Missing value for \(option)"
        }
    }
}
