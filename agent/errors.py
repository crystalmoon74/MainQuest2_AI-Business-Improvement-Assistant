class AnalysisError(Exception):
    """사용자에게 그대로 보여줄 수 있는 메시지를 가진 오류."""

    def __init__(self, message: str, retryable: bool = True):
        super().__init__(message)
        self.retryable = retryable
