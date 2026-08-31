import SwiftUI
import UIKit

struct NativeImagePreviewPayload: Decodable {
    let images: [NativeImagePreviewItem]
    let index: Int?
}

struct NativeImagePreviewItem: Decodable, Identifiable {
    let url: String
    let title: String?
    let fileName: String?

    var id: String { url + (title ?? "") }
}

struct NativeImageGallery: View {
    let items: [NativeImagePreviewItem]
    @State private var selection: Int
    @Environment(\.dismiss) private var dismiss

    init(items: [NativeImagePreviewItem], startIndex: Int) {
        self.items = items
        _selection = State(initialValue: startIndex)
    }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            TabView(selection: $selection) {
                ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                    RemoteGalleryImage(url: URL(string: item.url))
                        .tag(index)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))

            VStack {
                HStack {
                    Button(action: dismiss.callAsFunction) {
                        Image(systemName: "xmark")
                            .font(.system(size: 17, weight: .semibold))
                            .frame(width: 40, height: 40)
                            .background(.ultraThinMaterial, in: Circle())
                    }
                    .foregroundStyle(.white)

                    Spacer()

                    Text("\(selection + 1) / \(items.count)")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(.white)

                    Spacer()

                    Button(action: saveCurrentImage) {
                        Image(systemName: "square.and.arrow.down")
                            .font(.system(size: 17, weight: .semibold))
                            .frame(width: 40, height: 40)
                            .background(.ultraThinMaterial, in: Circle())
                    }
                    .foregroundStyle(.white)
                }
                .padding(.horizontal, 18)
                .padding(.top, 8)

                Spacer()

                if let title = items[selection].title, !title.isEmpty {
                    Text(title)
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(.white)
                        .lineLimit(2)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .background(.ultraThinMaterial, in: Capsule())
                        .padding(.bottom, 16)
                }
            }
        }
    }

    private func saveCurrentImage() {
        guard items.indices.contains(selection), let url = URL(string: items[selection].url) else { return }
        Task {
            guard let (data, response) = try? await URLSession.shared.data(from: url),
                  let http = response as? HTTPURLResponse,
                  (200..<300).contains(http.statusCode),
                  let image = UIImage(data: data) else {
                return
            }
            ImageStore.saveToPhotos(image: image) { _ in }
        }
    }
}

private struct RemoteGalleryImage: View {
    let url: URL?

    var body: some View {
        AsyncImage(url: url) { phase in
            switch phase {
            case .empty:
                ProgressView()
                    .tint(.white)
            case .success(let image):
                image
                    .resizable()
                    .scaledToFit()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            case .failure:
                VStack(spacing: 12) {
                    Image(systemName: "photo.badge.exclamationmark")
                        .font(.system(size: 36))
                    Text("图片加载失败")
                        .font(.system(size: 15))
                }
                .foregroundStyle(.white.opacity(0.78))
            @unknown default:
                EmptyView()
            }
        }
    }
}
